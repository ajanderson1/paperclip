import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parsePaperclipToolBridgeConfig,
  startPaperclipToolBridge,
  type PaperclipToolBridgeHandle,
  type StartPaperclipToolBridgeInput,
} from "./tool-bridge.js";

const runContext = {
  companyId: "company-1",
  agentId: "agent-1",
  projectId: "project-1",
  runId: "run-1",
  issueId: "issue-1",
};

const toolNames = ["ajanderson.journal-wiki:begin_operation"];
const activeBridges: PaperclipToolBridgeHandle[] = [];

async function startBridge(overrides: Partial<StartPaperclipToolBridgeInput> = {}) {
  const input: StartPaperclipToolBridgeInput = {
    hostApiToken: "host-secret",
    hostApiUrl: "http://paperclip.test",
    runContext,
    toolNames,
    forward: async () => ({ status: 200, body: { mode: "no_changes" } }),
  };
  Object.assign(input, overrides);
  const bridge = await startPaperclipToolBridge(input);
  activeBridges.push(bridge);
  return bridge;
}

async function invokeBridge(
  bridge: PaperclipToolBridgeHandle,
  body: unknown,
  capability = bridge.capability,
): Promise<Response> {
  return fetch(`${bridge.url}/invoke`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${capability}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(activeBridges.splice(0).map((bridge) => bridge.stop()));
});

describe("parsePaperclipToolBridgeConfig", () => {
  it("accepts an explicit list of fully namespaced plugin tools", () => {
    expect(
      parsePaperclipToolBridgeConfig({
        paperclipToolBridge: {
          toolNames: ["ajanderson.journal-wiki:begin_operation"],
        },
      }),
    ).toEqual({
      toolNames: ["ajanderson.journal-wiki:begin_operation"],
    });
  });

  it("rejects a tool name without its plugin namespace", () => {
    expect(() =>
      parsePaperclipToolBridgeConfig({
        paperclipToolBridge: { toolNames: ["begin_operation"] },
      }),
    ).toThrow("fully namespaced");
  });
});

describe("Paperclip tool bridge", () => {
  it("serves only its declared manifest to an authenticated extension", async () => {
    const bridge = await startBridge();

    const response = await fetch(`${bridge.url}/manifest`, {
      headers: { authorization: `Bearer ${bridge.capability}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { name: "ajanderson.journal-wiki:begin_operation" },
    ]);
  });

  it("forwards an allowed tool with server-owned run context", async () => {
    const forward = vi.fn(async () => ({ status: 200, body: { mode: "no_changes" } }));
    const bridge = await startBridge({ forward });

    const response = await invokeBridge(bridge, {
      tool: "ajanderson.journal-wiki:begin_operation",
      parameters: { issueId: "issue-1" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "no_changes" });
    expect(forward).toHaveBeenCalledWith({
      tool: "ajanderson.journal-wiki:begin_operation",
      parameters: { issueId: "issue-1" },
      runContext,
    });
  });

  it("rejects an undeclared capability before forwarding", async () => {
    const forward = vi.fn(async () => ({ status: 200, body: {} }));
    const bridge = await startBridge({ forward });

    const response = await invokeBridge(bridge, {
      tool: "ajanderson.journal-wiki:record_review",
      parameters: { issueId: "issue-1" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Tool is not allowed for this run." });
    expect(forward).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong opaque capability", async () => {
    const bridge = await startBridge();

    const missing = await invokeBridge(
      bridge,
      { tool: toolNames[0], parameters: { issueId: "issue-1" } },
      "",
    );
    const wrong = await invokeBridge(
      bridge,
      { tool: toolNames[0], parameters: { issueId: "issue-1" } },
      "wrong-capability",
    );

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  it("rejects a tool request for another issue before forwarding", async () => {
    const forward = vi.fn(async () => ({ status: 200, body: {} }));
    const bridge = await startBridge({ forward });

    const response = await invokeBridge(bridge, {
      tool: toolNames[0],
      parameters: { issueId: "issue-2" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Tool request does not match this run." });
    expect(forward).not.toHaveBeenCalled();
  });

  it("returns a bounded upstream failure", async () => {
    const bridge = await startBridge({
      forward: async () => ({ status: 500, body: { detail: "host-secret /private/path" } }),
    });

    const response = await invokeBridge(bridge, {
      tool: toolNames[0],
      parameters: { issueId: "issue-1" },
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Paperclip tool call failed." });
  });

  it("rejects calls after shutdown", async () => {
    const bridge = await startBridge();
    await bridge.stop();

    await expect(
      invokeBridge(bridge, { tool: toolNames[0], parameters: { issueId: "issue-1" } }),
    ).rejects.toThrow();
  });
});
