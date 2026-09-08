#!/usr/bin/env python3
"""A/B: does the delegate_task description make the model delegate linear work?

Sends the REAL tool schema (registry definitions) with the delegate_task description
swapped between two arms, one chat call per prompt, and counts whether the model's first
tool call is delegate_task. Linear prompts should score 0; parallel prompts should score 1.

    OPENROUTER_API_KEY=... python evals/delegation_routing/ab_probe.py --model <id> --n 1
"""
import argparse
import json
import os
import subprocess
import sys
import time

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

LINEAR = [
    "Read tools/registry.py and tell me what the check_fn TTL is.",
    "Fix the typo 'recieve' in README.md.",
    "What's the current git branch and how many commits ahead of origin/main is it?",
    "Add a docstring to the function `_p` in tools/delegate_tool.py.",
    "Run the test file tests/tools/test_delegate.py and tell me if it passes.",
    "Look up the latest stable Python release version.",
    "Rename the variable `overrides_params` to `params` in tools/delegate_tool.py and run ruff on it.",
    "Summarize what agent/prompt_builder.py does.",
]
PARALLEL = [
    "Review each of these 5 PRs independently and give me a verdict on each: #101, #102, #103, #104, #105.",
    "Research these three questions separately: how does Cline handle parallel tool calls, how does Aider do repo maps, how does OpenHands sandbox code execution.",
    "Audit every AGENTS.md in the repo (root, agent/, tools/, gateway/, hermes_cli/, plugins/) for stale file references — treat each one as its own job.",
    "Port these 4 unrelated bug fixes from the issue tracker into separate branches: #201, #202, #203, #204.",
]

def _tools(desc_override):
    import model_tools
    defs = model_tools.get_tool_definitions(quiet=True) if "quiet" in model_tools.get_tool_definitions.__code__.co_varnames else model_tools.get_tool_definitions()
    out = []
    for d in defs:
        f = dict(d.get("function", d))
        if f["name"] == "delegate_task" and desc_override is not None:
            f["description"] = desc_override
        out.append({"type": "function", "function": {k: f[k] for k in ("name", "description", "parameters") if k in f}})
    return out

def _old_description():
    src = subprocess.check_output(["git", "-C", ROOT, "show", "origin/main:tools/delegate_tool.py"], text=True)
    ns = {}
    # Extract the constant literals by exec'ing just the two assignments.
    import re
    head = re.search(r"^_DESCRIPTION_HEAD = \((?:.|\n)*?^\)\n", src, re.M).group(0)
    tail = re.search(r"^_DESCRIPTION_TAIL = \((?:.|\n)*?^\)\n", src, re.M).group(0)
    exec(head + tail, ns)
    return ns["_DESCRIPTION_HEAD"] + "- Children cannot call delegate_task, clarify, memory, or cronjob.\n" + ns["_DESCRIPTION_TAIL"]

def _call(client, model, tools, prompt):
    r = client.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": "You are Hermes, an autonomous coding agent working in the hermes-agent repo at " + ROOT + ". Use tools to do the work."},
                {"role": "user", "content": prompt},
            ],
            "tools": tools,
            "tool_choice": "auto",
            "max_tokens": 600,
            "usage": {"include": True},
        },
        timeout=120,
    )
    r.raise_for_status()
    j = r.json()
    msg = j["choices"][0]["message"]
    calls = [tc["function"]["name"] for tc in (msg.get("tool_calls") or [])]
    return calls, j.get("usage", {}), j.get("id")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="anthropic/claude-sonnet-4.5")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--smoke", action="store_true", help="one prompt per class, one arm")
    a = ap.parse_args()

    from tools.delegate_tool import _build_top_level_description
    arms = {"old": _tools(_old_description()), "new": _tools(_build_top_level_description())}
    prompts = [("linear", p) for p in LINEAR] + [("parallel", p) for p in PARALLEL]
    if a.smoke:
        prompts = [prompts[0], prompts[-1]]
        arms = {"new": arms["new"]}

    client = httpx.Client()
    rows = []
    cost = 0.0
    for arm, tools in arms.items():
        for kind, p in prompts:
            for i in range(a.n):
                calls, usage, rid = _call(client, a.model, tools, p)
                cost += float(usage.get("cost") or 0)
                rows.append({"arm": arm, "kind": kind, "prompt": p, "calls": calls,
                             "delegated": "delegate_task" in calls, "id": rid, "usage": usage})
                print(f"[{arm}/{kind}] delegated={'delegate_task' in calls} calls={calls[:3]} id={rid}", flush=True)
                time.sleep(0.3)

    out = os.path.join(ROOT, "evals", "delegation_routing", f"results_{int(time.time())}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1)
    print("\n== summary ==")
    for arm in arms:
        for kind in ("linear", "parallel"):
            sub = [r for r in rows if r["arm"] == arm and r["kind"] == kind]
            if sub:
                d = sum(r["delegated"] for r in sub)
                print(f"{arm:>4} {kind:>8}: delegated {d}/{len(sub)}")
    print(f"billed ${cost:.4f}  -> {out}")

if __name__ == "__main__":
    main()
