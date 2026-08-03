# Pi local provider-quota recovery plan

**Status:** parked — no implementation or deployment authorized by this document.

## Goal

Make a failed `pi_local` run that exhausts Pi retries after provider quota/rate-limit errors report `provider_quota` to Paperclip. Paperclip's existing recovery service must then schedule exactly one retry at the provider reset time when known, or use its existing default backoff when it is not.

## Confirmed baseline

- `packages/adapters/pi-local/src/server/parse.ts` records a failed Pi `auto_retry_end.finalError` as a generic parsed error.
- `packages/adapters/pi-local/src/server/execute.ts` returns that error without `errorCode`, `errorFamily`, or `retryNotBefore`.
- Claude and Codex adapters already emit `provider_quota` metadata.
- `server/src/services/recovery/service.ts` already creates and promotes a `scheduled_retry` for a failed run classified as `provider_quota`.

## Design

### 1. Paperclip-scoped Pi quota report extension

Add a small extension inside `packages/adapters/pi-local/`. The adapter loads it with Pi's `--extension` flag only for `pi_local` runs.

The extension observes Pi's `after_provider_response` event. For a 429 response, it writes a run-local JSON report at the path in `PAPERCLIP_PI_QUOTA_REPORT_PATH`.

The report contains only:

- report version;
- HTTP status;
- observed time;
- calculated `retryNotBefore`, when headers provide one.

It must never write response bodies, authorization data, prompts, or model output. It must parse `Retry-After` delta-seconds and HTTP dates first, then documented rate-limit reset headers. It writes atomically.

### 2. Adapter-owned classification and result contract

`pi_local` creates a private temporary report path before it starts Pi, passes it through the child environment, reads it after Pi exits, and always removes it.

After Pi's own retries are exhausted, the adapter classifies the final error as provider quota when either:

- the extension report confirms HTTP 429; or
- the final Pi error is an established quota signature, including HTTP 429, `RESOURCE_EXHAUSTED`, provider quota, usage-limit, or rate-limit text.

The extension report's valid future reset time wins. Otherwise the adapter parses a reset time from the final error text. If neither source yields one, it returns no reset time and leaves Paperclip recovery to apply its existing default backoff.

For a classified failure, the adapter returns:

- `errorCode: "provider_quota"`;
- `errorFamily: "provider_quota"`;
- top-level `retryNotBefore` when known;
- matching retry metadata in `resultJson`.

A successful Pi retry remains successful even if an earlier request received 429. Non-quota failures remain generic failures.

### 3. No recovery-service rewrite

Do not add a Pi-specific scheduler, HTTP callback, background process, or direct Paperclip mutation to the extension. Do not modify database state. The adapter is the only bridge to the control plane; the existing recovery service owns idempotent scheduling.

## Planned files

- Create: `packages/adapters/pi-local/src/extensions/paperclip-quota-report.ts`
- Create: focused tests for the extension's header-to-reset-time conversion.
- Modify: `packages/adapters/pi-local/src/server/parse.ts`
- Modify: `packages/adapters/pi-local/src/server/parse.test.ts`
- Modify: `packages/adapters/pi-local/src/server/execute.ts`
- Modify: `server/src/__tests__/pi-local-execute.test.ts`
- Modify only if existing coverage cannot express the contract: `server/src/__tests__/heartbeat-retry-scheduling.test.ts`

## Test-first implementation slices

1. Add failing unit tests for quota signatures and reset-time parsing from final Pi output.
2. Add failing extension tests for 429 response headers: delta `Retry-After`, HTTP-date `Retry-After`, and invalid/past headers.
3. Add failing adapter tests that verify classified output contains the provider-quota result contract and cleans up the report.
4. Add or strengthen a recovery scheduling test proving the classified Pi result creates one scheduled retry at its reported reset time.
5. Implement each smallest corresponding production slice, preserving green tests between slices.

## Verification

Run the narrow adapter tests first:

- `pnpm vitest run packages/adapters/pi-local/src/server/parse.test.ts`
- `pnpm vitest run server/src/__tests__/pi-local-execute.test.ts`
- `pnpm vitest run server/src/__tests__/heartbeat-retry-scheduling.test.ts`

Before a PR-ready hand-off, run:

- `pnpm --filter @paperclipai/adapter-pi-local typecheck`
- `pnpm test:run`
- `pnpm -r typecheck`

A later deployment must use the normal Paperclip canary path and a controlled fixture. It must not intentionally exhaust a real provider quota.

## Acceptance criteria

- A terminal Pi 429 produces `provider_quota` rather than generic `adapter_failed`.
- A future provider reset time survives into the failed run and becomes the scheduled retry time.
- Missing reset time uses existing Paperclip default recovery behavior.
- Only one scheduled retry is created for one failed run/issue recovery action.
- A successful automatic Pi retry creates no quota recovery.
- The extension is scoped to Paperclip `pi_local` invocations and leaves no report file behind.
- No provider secrets or response bodies are persisted.

## Explicit non-goals

- Changing Pi core retry policy.
- Replacing Paperclip's recovery service.
- Adding direct extension-to-Paperclip API calls.
- Deploying to himalayas now.
