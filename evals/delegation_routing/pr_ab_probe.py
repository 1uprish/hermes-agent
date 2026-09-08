#!/usr/bin/env python3
"""A/B: does the delegate_task description make the model fan out a single "work on this PR" task?

Reproduces the maintainer's session shape: Hermes-style system prompt with the hermes-agent-dev
SKILL.md preloaded, the REAL tool schema, and a one-line "work on PR #N" request. One chat call per
prompt; records whether the FIRST tool round contains delegate_task, per arm (old/new description).

    OPENROUTER_API_KEY=... python evals/delegation_routing/pr_ab_probe.py --model openai/gpt-6-astra --n 3
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

SKILL = os.path.expanduser("~/.hermes/skills/github/hermes-agent-dev/SKILL.md")

PR_PROMPTS = [
    "Review and salvage PR #105553",
    "work on https://github.com/NousResearch/hermes-agent/pull/105549",
    "take a look at #105547 and get it ready to merge",
    "Can you handle PR 105552? fix whatever's wrong with it",
    "Review PR #105550, live-repro it, and fix anything the reviewer would flag",
]

def _tools(desc_override):
    import model_tools
    out = []
    for d in model_tools.get_tool_definitions():
        f = dict(d.get("function", d))
        if f["name"] == "delegate_task":
            f["description"] = desc_override
        out.append({"type": "function", "function": {k: f[k] for k in ("name", "description", "parameters") if k in f}})
    return out

def _old_description():
    src = subprocess.check_output(["git", "-C", ROOT, "show", "origin/main:tools/delegate_tool.py"], text=True)
    ns = {}
    head = re.search(r"^_DESCRIPTION_HEAD = \((?:.|\n)*?^\)\n", src, re.M).group(0)
    tail = re.search(r"^_DESCRIPTION_TAIL = \((?:.|\n)*?^\)\n", src, re.M).group(0)
    exec(head + tail, ns)
    return ns["_DESCRIPTION_HEAD"] + "- Children cannot call delegate_task, clarify, memory, or cronjob.\n" + ns["_DESCRIPTION_TAIL"]

def _system():
    skill = open(SKILL, encoding="utf-8").read()
    return (
        "You are Hermes, an autonomous coding agent made by Nous Research, working in an isolated git worktree of the "
        f"hermes-agent repo at {ROOT} (branch hermes/probe). Use tools to do the work; do not just describe a plan.\n\n"
        "# Parallel tool calls\nWhen you need several pieces of information that don't depend on each other, request them "
        "together in a single response instead of one tool call per turn.\n\n"
        "[IMPORTANT: The user launched this CLI session with the \"hermes-agent-dev\" skill preloaded. Treat its instructions "
        "as active guidance for the duration of this session unless the user overrides them.]\n\n" + skill
    )

def _call(client, model, tools, system, prompt):
    for attempt in range(3):
        r = client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
            json={"model": model,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                  "tools": tools, "tool_choice": "auto", "max_tokens": 1500, "usage": {"include": True}},
            timeout=180)
        j = r.json()
        if "choices" in j:
            break
        print(f"  retry {attempt + 1}: {str(j)[:200]}", flush=True)
        time.sleep(5)
    else:
        raise RuntimeError(str(j)[:500])
    msg = j["choices"][0]["message"]
    calls = [tc["function"]["name"] for tc in (msg.get("tool_calls") or [])]
    ntasks = 0
    for tc in (msg.get("tool_calls") or []):
        if tc["function"]["name"] == "delegate_task":
            try:
                ntasks += len(json.loads(tc["function"]["arguments"]).get("tasks") or [])
            except Exception:
                pass
    return calls, ntasks, j.get("usage", {}), j.get("id")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="openai/gpt-6-astra")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--arms", default="old,new")
    ap.add_argument("--prompts", type=int, default=len(PR_PROMPTS))
    a = ap.parse_args()

    from tools.delegate_tool import _build_top_level_description
    descs = {"old": _old_description(), "new": _build_top_level_description()}
    system = _system()
    client = httpx.Client()
    rows, cost = [], 0.0
    for arm in a.arms.split(","):
        tools = _tools(descs[arm])
        for p in PR_PROMPTS[: a.prompts]:
            for _ in range(a.n):
                calls, ntasks, usage, rid = _call(client, a.model, tools, system, p)
                cost += float(usage.get("cost") or 0)
                rows.append({"arm": arm, "prompt": p, "calls": calls, "delegated": "delegate_task" in calls,
                             "subagents": ntasks, "id": rid, "usage": usage})
                print(f"[{arm}] delegated={'delegate_task' in calls} subagents={ntasks} calls={calls[:4]} id={rid}", flush=True)
    out = os.path.join(ROOT, "evals", "delegation_routing", f"pr_results_{int(time.time())}.json")
    json.dump(rows, open(out, "w", encoding="utf-8"), indent=1)
    print("\n== summary ==")
    for arm in a.arms.split(","):
        sub = [r for r in rows if r["arm"] == arm]
        print(f"{arm:>4}: delegated on first turn {sum(r['delegated'] for r in sub)}/{len(sub)}; "
              f"subagents spawned total {sum(r['subagents'] for r in sub)}")
    print(f"billed ${cost:.4f}  -> {out}")

if __name__ == "__main__":
    main()
