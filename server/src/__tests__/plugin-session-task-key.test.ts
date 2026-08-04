// Regression cover for plugin session ownership.
//
// Sessions created through the plugin SDK are owned by the creating plugin, and
// that ownership is proven by the SHAPE of `task_key` — `list`, `sendMessage`
// and `close` all resolve a session with `LIKE 'plugin:<pluginKey>:session:%'`.
//
// `create` used to store a caller-supplied `taskKey` verbatim, while the SDK
// exposed `taskKey?: string` with no documented format. A plugin that passed its
// own label therefore created a session it could neither use nor close.

import { describe, expect, it } from "vitest";
import { buildPluginSessionTaskKey, pluginSessionTaskKeyPrefix } from "../services/plugin-host-services.js";

const PLUGIN_KEY = "acme.plugin-example";
const PREFIX = `plugin:${PLUGIN_KEY}:session:`;

/** The exact ownership predicate the host applies on read. */
function hostWouldFindSession(pluginKey: string, taskKey: string): boolean {
  return taskKey.startsWith(pluginSessionTaskKeyPrefix(pluginKey));
}

describe("buildPluginSessionTaskKey", () => {
  it("generates an owned key when the caller supplies none", () => {
    const key = buildPluginSessionTaskKey(PLUGIN_KEY);
    expect(key.startsWith(PREFIX)).toBe(true);
    expect(hostWouldFindSession(PLUGIN_KEY, key)).toBe(true);
  });

  it("namespaces a caller's label instead of replacing the owned prefix", () => {
    // THE BUG: this exact input previously produced an unusable, unclosable session.
    const key = buildPluginSessionTaskKey(PLUGIN_KEY, "content-pass:run-01KZ6TFZ");
    expect(key).toBe(`${PREFIX}content-pass:run-01KZ6TFZ`);
    expect(hostWouldFindSession(PLUGIN_KEY, key)).toBe(true);
  });

  it("preserves the caller's label so it stays useful in run context", () => {
    // `task_key` is surfaced in the wake contextSnapshot, so the label must survive.
    expect(buildPluginSessionTaskKey(PLUGIN_KEY, "my-label")).toContain("my-label");
  });

  it("passes an already-prefixed key through byte-for-byte", () => {
    // The bundled plugin-llm-wiki hand-builds the prefix; it must not be double-wrapped.
    const existing = `${PREFIX}wiki:default:query:op-1`;
    expect(buildPluginSessionTaskKey(PLUGIN_KEY, existing)).toBe(existing);
  });

  it("keys sessions to the creating plugin, so another plugin cannot resolve them", () => {
    const key = buildPluginSessionTaskKey(PLUGIN_KEY, "shared-label");
    expect(hostWouldFindSession("other.plugin", key)).toBe(false);
  });

  it("produces a distinct key per call when none is supplied", () => {
    expect(buildPluginSessionTaskKey(PLUGIN_KEY)).not.toBe(buildPluginSessionTaskKey(PLUGIN_KEY));
  });

  it("REGRESSION: the pre-fix behaviour would have been unresolvable", () => {
    // What `create` used to store: the caller's string, verbatim.
    const preFix = "journal-wiki:content-pass:run-01KZ6TFZ";
    expect(hostWouldFindSession(PLUGIN_KEY, preFix)).toBe(false);
    // What it stores now.
    expect(hostWouldFindSession(PLUGIN_KEY, buildPluginSessionTaskKey(PLUGIN_KEY, preFix))).toBe(true);
  });
});
