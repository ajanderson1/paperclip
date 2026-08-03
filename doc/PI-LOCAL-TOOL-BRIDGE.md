# Pi local tool bridge

`adapterConfig.paperclipToolBridge.toolNames` enables a local-only, run-scoped capability bridge for `pi_local`. The adapter starts an authenticated loopback server with one opaque per-run capability and fixed run context. Pi receives the bridge URL and capability, not `PAPERCLIP_API_KEY`.

Bridge mode starts Pi with `--no-builtin-tools --no-extensions --no-skills --no-context-files`, one explicit bridge extension, and only aliases generated from the declared canonical tool names. The extension fetches public metadata once then registers one closure-bound custom tool per allowed name. It exposes no dispatcher; callers cannot select a plugin tool name.

Authorization is default-deny: a call must be both on the immutable bridge allowlist and admitted by Paperclip's agent-bound tool policy. The bridge binds every call to the adapter-owned company, agent, run, and project context; it rejects wrong method, path, bearer, tool, or issue binding. Shutdown removes the listener.

## Operations

Do not enable bridge mode for remote adapters. Verify the Pi child environment has no `PAPERCLIP_API_KEY`; never log the capability. Capability additions require a reviewed adapter configuration, matching plugin role declaration, tests, docs, and tool-profile reconciliation.

## Rollback

Pause affected agents/routines, remove their tool-profile binding, redeploy the prior Paperclip build, and verify no child bridge listener remains. Do not restore bearer, shell, generic HTTP, filesystem, or built-in Pi tools as a fallback.
