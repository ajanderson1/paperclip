import { describe, expect, it, vi } from "vitest";
import { registerBridgeTools } from "./paperclip-tool-bridge.js";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, parameters: Record<string, unknown>) => Promise<unknown>;
};

function fakePi() {
  const tools: RegisteredTool[] = [];
  return {
    tools,
    registerTool: vi.fn((tool: RegisteredTool) => tools.push(tool)),
  };
}

describe("registerBridgeTools", () => {
  it("registers one safe alias for each declared capability", async () => {
    const pi = fakePi();

    await registerBridgeTools(pi, {
      requestManifest: async () => [{
        name: "ajanderson.journal-wiki:begin_operation",
      }],
      invoke: async () => ({ mode: "no_changes" }),
    });

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    expect(pi.tools[0]?.name).toBe("journal_begin_operation");
  });

  it("captures the allowed tool name instead of accepting a caller-selected tool", async () => {
    const pi = fakePi();
    const invoke = vi.fn(async () => ({ mode: "no_changes" }));

    await registerBridgeTools(pi, {
      requestManifest: async () => [{
        name: "ajanderson.journal-wiki:begin_operation",
      }],
      invoke,
    });
    await pi.tools[0]?.execute("call-1", { issueId: "issue-1", tool: "record_approval" });

    expect(invoke).toHaveBeenCalledWith({
      tool: "ajanderson.journal-wiki:begin_operation",
      parameters: { issueId: "issue-1", tool: "record_approval" },
    });
  });

  it("rejects aliases that would collide after safe normalization", async () => {
    await expect(registerBridgeTools(fakePi(), {
      requestManifest: async () => [
        { name: "example.journal:run" },
        { name: "other.journal:run" },
      ],
      invoke: async () => ({}),
    })).rejects.toThrow("collision");
  });
});
