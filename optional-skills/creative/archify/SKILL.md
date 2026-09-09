---
name: archify
description: "Validated interactive architecture and workflow diagrams."
version: 1.0.0
author: tt-a1i (adapted by Nous Research)
license: MIT
dependencies: []
platforms: [linux, macos]
metadata:
  hermes:
    tags: [architecture, diagrams, visualization, html, mermaid, workflow]
    category: creative
    related_skills: [architecture-diagram, excalidraw, concept-diagrams]
    upstream: https://github.com/tt-a1i/archify
---

# Archify Skill

Archify turns a small typed JSON specification into a self-contained, interactive
HTML diagram (inline SVG, dark/light themes, pan/zoom, search, focus, relationship
tracing, PNG/JPEG/WebP/SVG/WebM export) with a machine-checked validation receipt.
It does NOT sketch freehand pictures, edit existing images, or render Mermaid
verbatim — Mermaid input is read for topology and re-authored as Archify JSON.
Static output is the default; enable motion only when the user asks for a demo.

## Relationship to architecture-diagram

Hermes ships a lighter bundled skill, `architecture-diagram` (same Cocoon AI
lineage), that produces static SVG-in-HTML diagrams with no toolchain. Use
**archify** instead when the user wants validated, interactive, exportable
diagrams and Node.js is available; use `architecture-diagram` for a quick static
picture or when Node/network is unavailable.

## When to Use

- Visualize system architecture, infrastructure, cloud/security/network topology.
- Technical workflows, approval gates, runbooks, CI/CD.
- API call sequences, request lifecycles, async traces.
- Data pipelines, ETL/ELT, lineage, governance (dataflow).
- State machines, status transitions, retries (lifecycle).
- Convert/beautify pasted Mermaid `flowchart`, `sequenceDiagram`, or `stateDiagram`.

## Prerequisites

- Node.js >= 18 on PATH (live-tested with v26). No npm install needed — the
  package is dependency-free at runtime.
- Network access for the one-time fetch below. `curl` and `unzip`.

## Setup

Fetch the pinned upstream package into a working directory (never into this
skill's directory). Pinned commit: `10722002bb8777ecb639d93c49586fae4adf3ae4`.

```bash
export ARCHIFY_SHA=10722002bb8777ecb639d93c49586fae4adf3ae4
mkdir -p ~/.cache/archify-$ARCHIFY_SHA && cd ~/.cache/archify-$ARCHIFY_SHA
curl -sL -o archify.zip "https://raw.githubusercontent.com/tt-a1i/archify/$ARCHIFY_SHA/archify.zip"
unzip -q -o archify.zip && cd archify
node bin/archify.mjs doctor   # sanity check
```

All commands below run from that `archify/` directory. If the cache dir already
exists with `archify/bin/archify.mjs` inside, skip the download. To update the
skill, re-fetch at a newer pinned SHA (resolve with
`git ls-remote https://github.com/tt-a1i/archify HEAD`) and re-test before
changing the pin here.

## Quick Reference

| Type | Use for | Schema | Example |
|---|---|---|---|
| `architecture` | Components, services, cloud/security boundaries, infra | `schemas/architecture.schema.json` | `examples/web-app.architecture.json` |
| `workflow` | Processes, approval gates, tool calls, runbooks, CI/CD | `schemas/workflow.schema.json` | `examples/incident-response.workflow.json` |
| `sequence` | API call chains, request lifecycles, async traces | `schemas/sequence.schema.json` | `examples/cache-miss-request.sequence.json` |
| `dataflow` | Pipelines, ETL/ELT, lineage, consumers | `schemas/dataflow.schema.json` | `examples/product-analytics.dataflow.json` |
| `lifecycle` | State/status transitions, retries, terminal states | `schemas/lifecycle.schema.json` | `examples/agent-run.lifecycle.json` |

Core commands (run with `node`, from the fetched `archify/` dir):

```bash
node bin/archify.mjs validate <type> <candidate.json> --quality showcase --json
node bin/archify.mjs deliver <type> <candidate.json> <output.html> --quality showcase --json
node bin/archify.mjs visual-check <output.html> --json
node bin/archify.mjs guide "<scenario>" --json        # type router when ambiguous
node bin/archify.mjs brands "<name>" --json           # brand mark lookup
node bin/archify.mjs migrate workflow <old.json> <new.json> --to-schema 2 --json
```

## Procedure

1. **Setup** (above) if the cached toolchain is absent.
2. **Choose the type** from the request (table above). When ambiguous, run
   `node bin/archify.mjs guide "<scenario>" --json`.
3. **Read only** the matching schema in `schemas/`, `schemas/common.schema.json`,
   and one matching example in `examples/` (use read_file). Fresh authorship:
   new stable IDs, domain wording, and layout — the example gives field shape,
   not facts. New workflows use `schema_version: 2`; keep v1 only to preserve an
   existing workflow's fixed geometry. For real product identity, query
   `node bin/archify.mjs brands "<name>" --json`; read
   `references/brand-marks.md` only for an unknown brand with a user-provided URL.
4. **Write the candidate JSON first** (write_file), before inspecting renderer
   internals. One clear main path, short side branches, sparse labels, at most
   12 primary nodes. Set `meta.quality_profile: "showcase"` unless the user
   explicitly wants a dense `standard` map. Start with automatic routes and
   labels; do not add `via`, `channelX`, `channelY`, or `labelAt` before a
   diagnostic calls for one — at most one diagnosed geometry control per repair.
5. **Validate** after every edit and immediately before handoff:
   `node bin/archify.mjs validate <type> <candidate.json> --quality showcase --json`.
   A receipt with only 4 artifact checks is basic validation, never showcase
   acceptance — a showcase pass reports all 9 artifact checks with 0 composition
   errors and 0 warnings. For workflow v2 geometry diagnosis, use
   `node bin/archify.mjs validate workflow <candidate.json> --layout-json`.
   A passing final validation freezes the candidate: never edit it afterward.
6. **Deliver** as final acceptance:
   `node bin/archify.mjs deliver <type> <candidate.json> <output.html> --quality showcase --json`.
   On failure, change only the diagnosed `subject`, verify `evidence`, choose
   from `supportedFixes`, and rerun. Stop and report truthfully if two
   consecutive rounds don't reach a new minimum error count.
7. **Optionally** collect browser evidence without modifying the delivered HTML:
   `node bin/archify.mjs visual-check <output.html> --json`. Keep the claims
   separate: deliver = deterministic artifact checks; visual-check = bounded
   browser evidence; perceptual polish needs a human or image-capable reviewer.
8. **Report**: HTML path, diagram type, validation summary, spec/artifact
   SHA-256 receipt, browser-evidence status. Never claim success for a non-zero
   exit or a visual inspection you did not perform.

Detailed contracts (vendored verbatim from upstream, MIT):
`references/authoring-contract.md` (field enums, spacing math, geometry repair),
`references/delivery-contract.md` (receipt fields, exit behavior, manual review),
`references/viewer-runtime.md` (Share Cards, motion, deep links — read only on
explicit user request), `references/brand-marks.md` (brand capture).

## Pitfalls

1. A **failed `deliver` preserves the previous last-good output** — never run
   `visual-check` on that path after a failure; it would inspect the stale
   artifact, not the failed candidate. A non-zero exit is never success.
2. **Showcase pass = all 9 artifact checks**, 0 errors, 0 warnings. Four checks
   is basic validation only. If `meta.quality_profile` is missing or misspelled,
   fix it before touching geometry.
3. **Never edit a frozen passing candidate** after its final validation.
4. Don't read `renderers/shared/geometry.mjs`, renderer/validator source, tests,
   or benchmarks before the first candidate exists; inspect implementation only
   after two focused repairs fail.
5. Relationship labels are semantic data — deleting one is not a geometry
   repair. Move the label, adjust route/spacing, then shorten wording.
6. Omit `meta.visual_preset`, `meta.subtitle`, `meta.legend`, and
   `meta.engineering_profile` by default; enable only on explicit user request.
7. Mermaid is input for meaning, not styling — author fresh Archify JSON.
8. Fetch the toolchain into a cache/working dir, never into the skill directory.

## Verification

- `node bin/archify.mjs doctor` exits 0 after setup.
- `validate ... --quality showcase --json` reports `"ok": true`, 9/9 checks,
  0 errors, 0 warnings.
- `deliver` prints spec + artifact SHA-256 and byte counts;
  `"compositionStatus": "pass"`; the output HTML exists and opens standalone.

---
Upstream: https://github.com/tt-a1i/archify (MIT, tt-a1i; based on
Cocoon-AI/architecture-diagram-generator, MIT). See LICENSE.txt.
