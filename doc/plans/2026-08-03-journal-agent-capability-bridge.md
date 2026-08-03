# Journal Agent Capability Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Journal Paperclip agents use only role-declared plugin capabilities without shell/filesystem tools or a generic Paperclip bearer in the Pi process.

**Architecture:** Add an opt-in local `paperclipToolBridge` mode to `pi_local`. It starts a loopback bridge with host-held agent auth and launches Pi with every built-in/discovered resource disabled except a trusted extension that registers one closure-bound custom tool per allowed capability. The Journal plugin declares roles and tools once, then uses plugin lifecycle tools rather than curl for every state transition.

**Tech Stack:** TypeScript, Node HTTP server, Pi extensions, Vitest, Paperclip plugin SDK, `pnpm`.

## Global Constraints

- Preserve ordinary `pi_local` behavior when `paperclipToolBridge` is absent.
- Bridge mode is local-execution only in this slice; a remote target must fail closed rather than fall back to a credential-bearing or shell-enabled run.
- The Pi child environment must not include `PAPERCLIP_API_KEY` in bridge mode.
- Bridge mode uses `--no-builtin-tools --no-extensions --no-skills --no-context-files` and one explicit trusted extension.
- The bridge must bind calls to its immutable company, agent, project, run, issue, and allowed-tool context.
- Every role remains subject to Paperclip's agent-bound default-deny tool profile; bridge allowlisting never substitutes for that server-side policy.
- Journal agents never regain generic REST, curl, CLI, shell, or filesystem capability.
- Never mutate or restart legacy `personal_admin_suite/journal_wiki`.
- No credential, bridge token, auth header, or local path appears in agent-visible errors, activity, or runtime logs.

---

### Task 1: Define and test the generic bridge-mode adapter contract

**Files:**
- Create: `packages/adapters/pi-local/src/server/tool-bridge.ts`
- Create: `packages/adapters/pi-local/src/server/tool-bridge.test.ts`
- Modify: `packages/adapters/pi-local/src/server/execute.ts`
- Modify: `packages/adapters/pi-local/src/index.ts`
- Test: `packages/adapters/pi-local/src/server/tool-bridge.test.ts`

**Interfaces:**
- Consumes: `AdapterExecutionContext` (`runId`, `agent`, `context`, `authToken`) and `adapterConfig.paperclipToolBridge`.
- Produces: `PaperclipToolBridgeHandle` with `extensionPath`, `env`, and `stop(): Promise<void>`.
- Produces: `parsePaperclipToolBridgeConfig(config): { toolNames: string[] } | null`.
- Later tasks rely on: bridge-mode Pi arguments and the loopback request contract.

- [ ] **Step 1: Write failing configuration tests**

```ts
expect(parsePaperclipToolBridgeConfig({
  paperclipToolBridge: {
    toolNames: ["ajanderson.journal-wiki:begin_operation"],
  },
})).toEqual({
  toolNames: ["ajanderson.journal-wiki:begin_operation"],
});

expect(() => parsePaperclipToolBridgeConfig({
  paperclipToolBridge: { toolNames: ["begin_operation"] },
})).toThrow("fully namespaced");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paperclipai/adapter-pi-local exec vitest run src/server/tool-bridge.test.ts`

Expected: FAIL because `parsePaperclipToolBridgeConfig` does not exist.

- [ ] **Step 3: Implement the smallest validated config parser**

Add `parsePaperclipToolBridgeConfig` in `tool-bridge.ts`. It returns `null` when the config is absent; otherwise rejects empty arrays, duplicate entries, non-strings, and names not matching `<plugin-id>:<tool-name>`. Do not add a permissive wildcard form.

- [ ] **Step 4: Write failing loopback authorization tests**

```ts
const bridge = await startPaperclipToolBridge({
  hostApiToken: "host-secret",
  hostApiUrl: "http://paperclip.test",
  runContext: {
    companyId: "company-1", agentId: "agent-1", projectId: "project-1",
    runId: "run-1", issueId: "issue-1",
  },
  toolNames: ["ajanderson.journal-wiki:begin_operation"],
});

await expect(invokeBridge(bridge, {
  tool: "ajanderson.journal-wiki:record_review", parameters: {},
})).rejects.toThrow("not allowed");
expect(fetch).not.toHaveBeenCalled();
```

Add cases for missing/wrong opaque capability, malformed body, wrong issue id supplied by the extension payload, non-200 upstream result, and use after `stop()`.

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm --filter @paperclipai/adapter-pi-local exec vitest run src/server/tool-bridge.test.ts`

Expected: FAIL because `startPaperclipToolBridge` does not exist.

- [ ] **Step 6: Implement the local bridge**

Use Node's loopback HTTP server, bind only `127.0.0.1` on an ephemeral port, and create a random opaque capability token. Accept only `POST /invoke` with that token and a JSON body of `{ tool, parameters }`. Capture the configured name in the bridge server; reject any unlisted name before forwarding.

Build `runContext` only from `AdapterExecutionContext`, not request input. Forward only to `/api/plugins/tools/execute` with host-held auth and the immutable `runContext`. Return only bounded response JSON. Redact/replace upstream errors that contain auth material, filesystem paths, or implementation details. Close the listener and invalidate the token in `stop()`.

- [ ] **Step 7: Run focused tests to verify they pass**

Run: `pnpm --filter @paperclipai/adapter-pi-local exec vitest run src/server/tool-bridge.test.ts`

Expected: PASS; denied requests never reach `fetch`, allowed requests contain the server-built context, and stopped bridges reject calls.

- [ ] **Step 8: Wire bridge mode into Pi invocation**

In `execute.ts`, parse bridge config before constructing Pi arguments. For local bridge-mode runs, retain `authToken` only in the parent while creating the bridge, then remove `PAPERCLIP_API_KEY` from the child environment. Append the explicit extension path and bridge-only flags. For remote bridge-mode runs, throw a clear, non-sensitive unsupported-target error. Keep current arguments unchanged when the config is absent.

Update `agentConfigurationDoc` in `index.ts` to describe the opt-in config, exact security behavior, local-only limit, and default-deny policy dependency.

- [ ] **Step 9: Write failing invocation tests**

Create `packages/adapters/pi-local/src/server/execute.test.ts` with mocked process execution. Assert bridge mode receives:

```ts
expect(args).toEqual(expect.arrayContaining([
  "--no-builtin-tools", "--no-extensions", "--no-skills", "--no-context-files",
  "--extension", expect.stringContaining("paperclip-tool-bridge"),
]));
expect(args).not.toContain("bash");
expect(processOptions.env.PAPERCLIP_API_KEY).toBeUndefined();
```

Also assert a no-bridge agent still receives its existing `--tools read,bash,edit,write,grep,find,ls` arguments.

- [ ] **Step 10: Run invocation tests to verify they fail**

Run: `pnpm --filter @paperclipai/adapter-pi-local exec vitest run src/server/execute.test.ts`

Expected: FAIL until bridge-mode argument construction and env scrubbing are wired.

- [ ] **Step 11: Run all adapter tests and typecheck**

Run:

```sh
pnpm --filter @paperclipai/adapter-pi-local exec vitest run
pnpm --filter @paperclipai/adapter-pi-local typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit**

```sh
git add packages/adapters/pi-local/src/server/tool-bridge.ts \
  packages/adapters/pi-local/src/server/tool-bridge.test.ts \
  packages/adapters/pi-local/src/server/execute.ts \
  packages/adapters/pi-local/src/server/execute.test.ts \
  packages/adapters/pi-local/src/index.ts
git commit -m "feat(pi): add run-scoped plugin tool bridge"
```

### Task 2: Load only closure-bound custom Pi tools

**Files:**
- Create: `packages/adapters/pi-local/src/runtime/paperclip-tool-bridge.ts`
- Create: `packages/adapters/pi-local/src/runtime/paperclip-tool-bridge.test.ts`
- Modify: `packages/adapters/pi-local/src/server/tool-bridge.ts`
- Modify: `packages/adapters/pi-local/src/server/execute.test.ts`
- Test: `packages/adapters/pi-local/src/runtime/paperclip-tool-bridge.test.ts`

**Interfaces:**
- Consumes: bridge URL and opaque capability from the bridge-only runtime environment.
- Produces: one Pi custom-tool registration per server-announced `{ name, displayName, description, parametersSchema }` entry.
- Produces: each custom tool closure posts only its fixed tool name plus caller parameters to `/invoke`.
- Later tasks rely on: exact custom-tool list and rejection of generic dispatch.

- [ ] **Step 1: Write failing extension registration tests**

```ts
await registerBridgeTools(fakePi, {
  requestManifest: async () => [{
    name: "ajanderson.journal-wiki:begin_operation",
    displayName: "Begin Journal Operation",
    description: "Prepare a candidate.",
    parametersSchema: { type: "object", properties: { issueId: { type: "string" } }, required: ["issueId"] },
  }],
});
expect(fakePi.registerTool).toHaveBeenCalledTimes(1);
expect(fakePi.registerTool.mock.calls[0][0].name).toBe("journal_begin_operation");
```

Add a call test that verifies the registered closure cannot accept a caller-selected plugin tool name.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paperclipai/adapter-pi-local exec vitest run src/runtime/paperclip-tool-bridge.test.ts`

Expected: FAIL because the extension module does not exist.

- [ ] **Step 3: Implement the explicit bridge extension**

Use Pi's extension API and `TypeBox`. The extension fetches the bridge manifest once, registers a safe local alias for each allowed tool, and posts to the bridge with the opaque capability. Tool aliases are deterministic and collision-checked. The extension exposes no generic dispatcher, command, filesystem helper, shell helper, or environment inspection facility.

The bridge manifest is generated from the adapter config and contains only public tool metadata. The server retains the canonical tool name and all authorization context. Convert bridge/network failures to bounded errors without dumping response headers or raw bodies.

- [ ] **Step 4: Run extension tests to verify they pass**

Run: `pnpm --filter @paperclipai/adapter-pi-local exec vitest run src/runtime/paperclip-tool-bridge.test.ts`

Expected: PASS; one allowed capability equals one custom Pi tool and tool identity is closure-bound.

- [ ] **Step 5: Add end-to-end adapter argument assertions**

Extend `execute.test.ts` to assert bridge mode contains only the generated aliases in `--tools`, includes the explicit extension, and never adds `--skill` or the old built-in tool allowlist.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```sh
pnpm --filter @paperclipai/adapter-pi-local exec vitest run src/server/execute.test.ts src/runtime/paperclip-tool-bridge.test.ts
pnpm --filter @paperclipai/adapter-pi-local typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/adapters/pi-local/src/runtime/paperclip-tool-bridge.ts \
  packages/adapters/pi-local/src/runtime/paperclip-tool-bridge.test.ts \
  packages/adapters/pi-local/src/server/tool-bridge.ts \
  packages/adapters/pi-local/src/server/execute.test.ts
git commit -m "feat(pi): expose only bridge-declared custom tools"
```

### Task 3: Make Journal lifecycle bridge-only

**Files:**
- Create: `src/pipeline/capabilities.ts` in a fresh `ajanderson_journal_wiki` worktree
- Modify: `src/manifest.ts`
- Modify: `src/tools/register.ts`
- Modify: `src/pipeline/operations.ts`
- Modify: `agents/journal-drafter/AGENTS.md`
- Modify: `agents/journal-reviewer/AGENTS.md`
- Modify: `agents/journal-approver/AGENTS.md`
- Create: `tests/unit/capabilities.test.ts`
- Modify: `tests/integration/worker.test.ts`

**Interfaces:**
- Consumes: the core bridge config `{ toolNames: string[] }` implemented in Tasks 1–2.
- Produces: `JOURNAL_ROLE_CAPABILITIES`, mapping each managed role to canonical namespaced plugin tools.
- Produces: `complete_no_changes(issueId)` and `handoff_to_review(issueId, revision, candidateCommit, manifestSha256)` plugin tools.
- Later tasks rely on: role declarations and lifecycle effects being fully plugin-owned.

- [ ] **Step 1: Create failing role-declaration tests**

```ts
expect(JOURNAL_ROLE_CAPABILITIES.drafter).toEqual([
  "ajanderson.journal-wiki:begin_operation",
  "ajanderson.journal-wiki:inspect_candidate",
  "ajanderson.journal-wiki:complete_no_changes",
  "ajanderson.journal-wiki:handoff_to_review",
]);
expect(JOURNAL_ROLE_CAPABILITIES.reviewer).not.toContain(
  "ajanderson.journal-wiki:record_approval",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/unit/capabilities.test.ts`

Expected: FAIL because the capability declaration does not exist.

- [ ] **Step 3: Implement the single capability declaration and manifest wiring**

Add `capabilities.ts` with closed role keys, duplicate rejection, and helpers returning a copy of a role's names. Change `manifest.ts` so each managed agent receives its own `adapterConfig.paperclipToolBridge.toolNames`; retain `permissions.pluginTools` as the separate server authorization precondition.

- [ ] **Step 4: Write failing lifecycle-tool tests**

Add integration assertions that `complete_no_changes` only closes the calling operation's routine issue and that `handoff_to_review` validates the revision, candidate commit, and manifest hash before applying the native review execution policy. Wrong role, stale revision, or mismatched immutable package must fail without changing the issue.

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm test -- tests/integration/worker.test.ts`

Expected: FAIL because the lifecycle tools are not registered.

- [ ] **Step 6: Implement plugin-owned lifecycle tools**

Add tool schemas and service methods that derive all issue status/comment/execution-policy changes from the validated stored operation. Do not accept arbitrary comment body, generic patch data, agent id, run id, project id, or status from the model. Retire curl/API examples from all three agent instructions; replace them with only their declared bridge aliases and terminal dispositions.

- [ ] **Step 7: Run targeted tests, then project verification**

Run:

```sh
pnpm test -- tests/unit/capabilities.test.ts tests/integration/worker.test.ts
pnpm typecheck
pnpm biome check .
pnpm build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add src/pipeline/capabilities.ts src/manifest.ts src/tools/register.ts \
  src/pipeline/operations.ts agents/journal-*/AGENTS.md \
  tests/unit/capabilities.test.ts tests/integration/worker.test.ts
git commit -m "feat(journal): declare bridge-only agent capabilities"
```

### Task 4: Document, synchronize policy, and prove the no-seed canary

**Files:**
- Create: `doc/PI-LOCAL-TOOL-BRIDGE.md`
- Modify: `packages/adapters/pi-local/src/index.ts`
- Create: `docs/reference/journal-agent-capabilities.md` in `ajanderson_journal_wiki`
- Modify: `docs/index.md` in `ajanderson_journal_wiki`
- Modify: `TESTING.md` in `ajanderson_journal_wiki`
- Test: `tests/unit/docs-contracts.test.ts` in `ajanderson_journal_wiki`

**Interfaces:**
- Consumes: `JOURNAL_ROLE_CAPABILITIES` and the active Paperclip tool-profile API.
- Produces: operator-visible architecture, role matrix, expansion checklist, policy reconciliation instructions, canary/rollback procedure, and documentation-drift test.
- Produces: evidence that the deployed Pi child has no bearer and no built-ins before any Journal write canary.

- [ ] **Step 1: Write failing documentation-contract test**

```ts
const doc = await readFile("docs/reference/journal-agent-capabilities.md", "utf8");
for (const tool of Object.values(JOURNAL_ROLE_CAPABILITIES).flat()) {
  expect(doc).toContain(tool);
}
expect(doc).toContain("default-deny");
expect(doc).toContain("rollback");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/unit/docs-contracts.test.ts`

Expected: FAIL because the capability document does not exist.

- [ ] **Step 3: Write operator and capability documentation**

Document architecture, trust boundary, capability matrix, adding/removing a capability, default-deny tool-profile reconciliation, errors/denials, no-seed canary, exact rollback, and the rule that the legacy PAS worker is deprecated and remains stopped. Link the Paperclip generic bridge document from the Journal document.

- [ ] **Step 4: Run documentation tests and full local verification**

Run:

```sh
pnpm test -- tests/unit/docs-contracts.test.ts
pnpm typecheck
pnpm test
pnpm biome check .
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Deploy only after both PRs are reviewed and merged**

On Himalayas: back up the Paperclip instance, deploy the Paperclip build containing Tasks 1–2, verify health/version, and verify the Journal plugin branch containing Task 3 is installed. Keep the legacy PAS `journal_wiki_scheduler` stopped. Reconcile an agent-bound default-deny profile to exactly match the documented role matrix, then read the effective profile back.

- [ ] **Step 6: Run an attended no-seed canary**

Resume only the Drafter and invoke one manual no-seed operation with the routine schedule still disabled. Verify from server-side invocation metadata that:

```text
--no-builtin-tools --no-extensions --no-skills --no-context-files
PAPERCLIP_API_KEY absent from Pi child environment
only declared bridge aliases invoked
POST /api/plugins/tools/execute returned 200 for the real run
no coordination or Journal ref changed
```

Pause the Drafter after the run. If any check fails, remove the agent's tool-profile binding, pause all Journal agents/routines, and redeploy the prior Paperclip build.

- [ ] **Step 7: Commit documentation**

```sh
git add doc/PI-LOCAL-TOOL-BRIDGE.md packages/adapters/pi-local/src/index.ts
git commit -m "docs(pi): document capability bridge operations"
```

In `ajanderson_journal_wiki`:

```sh
git add docs/reference/journal-agent-capabilities.md docs/index.md TESTING.md tests/unit/docs-contracts.test.ts
git commit -m "docs(journal): publish agent capability contract"
```

## Plan self-review

- **Spec coverage:** Tasks 1–2 implement local run-scoped bridge isolation, Pi tool elimination, no-bearer child env, call binding, cleanup, and compatibility. Task 3 makes Journal lifecycle bridge-only from one role declaration. Task 4 implements transparent docs, dual policy reconciliation, rollback, and bounded canary evidence.
- **Placeholder scan:** complete; every implementation and test step is specified.
- **Type consistency:** `paperclipToolBridge.toolNames`, `PaperclipToolBridgeHandle`, and `JOURNAL_ROLE_CAPABILITIES` are defined once and used consistently across tasks.
