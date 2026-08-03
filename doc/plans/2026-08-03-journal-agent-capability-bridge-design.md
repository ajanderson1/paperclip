# Journal Agent Capability Bridge Design

**Status:** approved for implementation  
**Date:** 2026-08-03  
**Scope:** Paperclip `pi_local` adapter plus `ajanderson.journal-wiki` integration

## Decision

Journal agents run only through a run-scoped, capability-limited bridge. They receive neither a shell nor a generic Paperclip bearer credential. This replaces the current `pi_local` invocation, which unconditionally enables `read,bash,edit,write,grep,find,ls` and gives the Pi process `PAPERCLIP_API_KEY`.

This is a Paperclip replacement path. The legacy `personal_admin_suite/journal_wiki` scheduler remains stopped and is not part of the design.

## Goals

- A Journal Drafter, Reviewer, or Approver can invoke only its explicitly declared Journal tools.
- Pi receives no built-in filesystem/shell tools, discovered extensions, skills, or context files.
- Pi receives no Paperclip bearer key. A model cannot acquire generic API authority by reading environment or files.
- Every tool invocation remains bound to the authentic agent, company, project, run, and assigned issue.
- Existing Paperclip tool profiles remain a second, server-side default-deny authorization gate.
- Adding a future capability is deliberate, reviewable, tested, and documented from one declaration.

## Non-goals

- General sandboxing of every `pi_local` agent in this change.
- Restoring or modifying the legacy `personal_admin_suite/journal_wiki` worker.
- Giving Journal agents generic issue REST access, arbitrary workspace access, or arbitrary plugin-tool access.
- Automatically approving or publishing Journal content.

## Architecture

### 1. Generic `pi_local` bridge mode

Add an opt-in `adapterConfig.paperclipToolBridge` object to `pi_local`.

```ts
{
  toolNames: ["ajanderson.journal-wiki:begin_operation"],
}
```

When absent, existing `pi_local` behavior remains compatible. When present, the adapter:

1. validates each fully namespaced allowed tool name;
2. starts a local, run-scoped bridge that holds agent authentication and expires when the run ends;
3. starts Pi with `--no-builtin-tools`, `--no-extensions`, `--no-skills`, and `--no-context-files`;
4. explicitly loads only a trusted Paperclip bridge extension and enables only the bridge tools;
5. omits `PAPERCLIP_API_KEY` from Pi's child environment.

The bridge extension receives only an opaque, run-scoped capability to reach the local bridge. It registers one Pi custom tool per allowed Paperclip plugin tool. It cannot register a generic HTTP, shell, file, environment, or plugin-tool dispatcher.

The local bridge accepts a call only when all inputs agree with its immutable run context: company, agent, project, run, assigned issue, and configured allowed tool set. It calls the existing Paperclip plugin-tool route using host-held authentication. The opaque capability expires and the bridge closes at run cleanup.

### 2. Journal role capability declaration

`ajanderson.journal-wiki` owns a single role-to-tool declaration. It is the source for:

- each managed agent's `paperclipToolBridge.toolNames` adapter config;
- the user-facing capability matrix;
- validation tests ensuring roles cannot receive undeclared tools.

The initial roles are deliberately narrow:

| Role | Capabilities |
|---|---|
| Drafter | `begin_operation`, `inspect_candidate`, `complete_no_changes`, `handoff_to_review` |
| Reviewer | `inspect_candidate`, `record_review` |
| Approver | `inspect_candidate`, `record_approval` |

The plugin owns lifecycle effects previously performed with curl:

- `complete_no_changes` records the truthful no-work disposition and closes the routine issue.
- `handoff_to_review` validates the immutable operation package, applies the native review policy, and moves the issue to its governed review state.

No Journal role receives a generic issue update, comment, document, curl, or CLI capability.

### 3. Dual authorization

A requested operation must pass both layers:

1. **Runtime bridge:** the adapter's immutable per-run allowlist and binding checks.
2. **Paperclip tool policy:** an agent-bound, default-deny profile that includes the same namespaced tools.

Either missing grant fails closed. The bridge returns a safe, actionable denial without credentials, local paths, host details, or hidden tool names.

## Capability expansion contract

To add a capability later:

1. Add a narrowly named plugin tool with a closed schema and explicit ownership checks.
2. Add it to one or more roles in the Journal declaration.
3. Reconcile the managed plugin and add the exact name to the corresponding Paperclip default-deny tool profile.
4. Run capability-matrix validation and the bridge tests.
5. Update the generated/checked capability matrix and expansion log in Journal docs.
6. Run a bounded canary before enabling a scheduled routine.

The declaration and docs deliberately make expansion easy to review, but never automatic or silent. A broader capability requires a code review and a visible authorization change.

## Observability and documentation

Paperclip records bridge startup, authorized tool calls, denials, cleanup, and run outcome with redacted structured activity/log detail. It never persists opaque bridge capability values, bearer credentials, or request headers.

Documentation will include:

- this runtime architecture and threat model;
- a role/capability matrix with tool purpose, input boundary, and effect;
- an operator guide for reconciling the second tool-policy gate;
- a future-capability checklist and canary procedure;
- an incident/rollback section: pause agents and routines, remove role capability declaration, remove tool-profile inclusion, and redeploy the prior Paperclip build.

## Acceptance criteria

### Adapter

- Bridge-mode command arguments disable all built-ins, extension discovery, skills, and context-file discovery.
- Bridge-mode child environment has no `PAPERCLIP_API_KEY`.
- Only the explicitly configured bridge extension and declared custom tools are exposed.
- Unknown, cross-company, wrong-run, wrong-agent, wrong-project, wrong-issue, malformed, and undeclared tool calls are rejected.
- Bridge teardown invalidates future calls.
- Non-bridge agents retain current behavior.

### Journal plugin

- The role declaration drives each managed agent's bridge configuration.
- Drafter can complete no-change and review handoff without a direct API client.
- Reviewer and Approver have no direct lifecycle/API capability outside their named tools.
- Each tool rejects an actor or issue outside its intended pipeline stage.
- Tests fail if the checked capability documentation diverges from the declaration.

### Operations

- A read-only, no-seed Paperclip canary completes without a shell tool call or API credential in Pi's process environment.
- Server-side tool-policy evidence shows only authorized namespaced calls.
- The real Journal remains unchanged until a later, separately approved one-source candidate canary.
