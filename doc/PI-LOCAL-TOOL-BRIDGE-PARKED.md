# PARKED — pi_local tool bridge

**Status: parked, not merged, not deployed.** This branch is an archive. Do not merge it to `master`.

**Date parked:** 2026-08-03
**Branch:** `feat/secure-journal-capability-bridge`
**Archive tag:** `archive/pi-local-tool-bridge` (points at merge `0f2bfb69f`)
**Reverted from master by:** `revert/pi-local-tool-bridge`
**Owner:** AJ Anderson

## What this is

A run-scoped capability bridge for the `pi_local` adapter. When an agent's
`adapterConfig.paperclipToolBridge.toolNames` is set, the adapter starts an
authenticated loopback HTTP server, withholds `PAPERCLIP_API_KEY` from the Pi
child process, and launches Pi with
`--no-builtin-tools --no-extensions --no-skills --no-context-files` plus a single
bridge extension exposing only the declared plugin tools. Authorization is
default-deny and doubly gated: the immutable bridge allowlist *and* Paperclip's
agent-bound tool policy must both admit a call.

Technically it works. It is opt-in, it changes nothing for agents that do not set
the config key, and its tests pass.

## Why it was built

It was built to satisfy a security constraint on the Journal Wiki plugin
(`ajanderson.plugin-journal-wiki`): that Journal-maintaining agents should have
no shell, no filesystem, no generic REST, and no bearer-token access to Paperclip.

## Why it is parked

That constraint was **over-applied**. It was inferred from an early framing and
then treated as immutable, when the actual product requirement moved.

The Journal Wiki workflow requires agents that can genuinely research: read the
surrounding vault, follow backlinks, run semantic search (`qmd`), and reason over
what they find. That is *ordinary* Paperclip `pi_local` behaviour — normal
filesystem and command access, normal skills, normal env.

Worse, a tool-free agent is precisely the documented root cause of the previous
system's failure. From the V3 design corpus
(`journal_wiki/docs/brainstorms/2026-07-27-deepdive-agent-architecture.md`), on
why V1's ingestion was poor:

> **Tool-free single-shot maintainer** — retrieval done in a separate pre-pass;
> the model could never follow a lead, check a backlink, or ask itself a second
> question.

The bridge would have re-imposed exactly that limitation, at the cost of a
permanent local fork of a core Paperclip adapter. The real safety story for the
Journal plugin is, and always was, elsewhere and already built:

- agents draft in a **throwaway detached git worktree**, never the live vault;
- agents **never commit and never push** — the plugin publishes deterministically;
- a **deterministic gate battery** confines paths and validates schema;
- **CAS fast-forward-only** publication with a freshness check discards stale work;
- **human approval** gates publication.

The bridge protected against a threat those controls already cover, while
removing the capability the product actually needs.

## When it might be useful again

Reconsider this branch if, and only if:

1. A genuinely untrusted third-party agent must be run against Paperclip data, and
2. worktree isolation + gates + publisher-mediated writes are demonstrably
   insufficient, and
3. the requirement justifies carrying a permanent local patch to
   `packages/adapters/pi-local` across upstream merges.

If it is revived, **cherry-pick fresh** — do not re-merge. The original merge was
reverted on `master`, so a re-merge would be a no-op.

## Contents

| File | Lines | Note |
|---|---|---|
| `packages/adapters/pi-local/src/server/tool-bridge.ts` | 261 | loopback bridge server |
| `packages/adapters/pi-local/src/server/tool-bridge.test.ts` | 175 | |
| `packages/adapters/pi-local/src/runtime/paperclip-tool-bridge.ts` | 124 | Pi extension |
| `packages/adapters/pi-local/src/runtime/paperclip-tool-bridge.test.ts` | 59 | |
| `packages/adapters/pi-local/src/server/execute.ts` | +43/−5 | **only meaningful upstream file modified** |
| `packages/adapters/pi-local/src/index.ts` | +4/−1 | doc string |
| `packages/adapters/pi-local/src/server/execute.test.ts` | 139 | new |
| `doc/PI-LOCAL-TOOL-BRIDGE.md` | 15 | operator doc |
| `doc/plans/2026-08-03-journal-agent-capability-bridge*.md` | 527 | design + sequencing |

## Operational warning if reverting on a live instance

After the revert, an agent whose config still carries a `paperclipToolBridge` key
will have that key **silently ignored** — it regains the default tool set
(`read,bash,edit,write,grep,find,ls`) and `PAPERCLIP_API_KEY` in its environment.
Audit agent configurations before reverting a deployed instance. As of the park
date no agent on the himalayas deployment had this key set, and the bridge was
never deployed.
