import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { ensurePiModelConfiguredAndAvailable, runAdapterExecutionTargetProcess } = vi.hoisted(() => ({
  ensurePiModelConfiguredAndAvailable: vi.fn(async () => undefined),
  runAdapterExecutionTargetProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: `${JSON.stringify({
      type: "turn_end",
      message: {
        role: "assistant",
        content: "done",
        usage: { input: 1, output: 1, cacheRead: 0, cost: { total: 0 } },
      },
    })}\n`,
    stderr: "",
  })),
}));

vi.mock("./models.js", () => ({ ensurePiModelConfiguredAndAvailable }));

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    ensureAdapterExecutionTargetRuntimeCommandInstalled: vi.fn(async () => undefined),
    ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => undefined),
    resolveAdapterExecutionTargetCommandForLogs: vi.fn(async () => "pi"),
    runAdapterExecutionTargetProcess,
  };
});

import { execute } from "./execute.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function executeFixture(adapterConfig: Record<string, unknown>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-pi-bridge-test-"));
  cleanupDirs.push(root);
  const workspace = path.join(root, "workspace");
  const session = path.join(root, "session.jsonl");
  await writeFile(session, `${JSON.stringify({ type: "session", cwd: workspace })}\n`);

  await execute({
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Journal Drafter",
      adapterType: "pi_local",
      adapterConfig,
    },
    runtime: {
      sessionId: session,
      sessionParams: { sessionId: session, cwd: workspace },
      sessionDisplayId: null,
      taskKey: null,
    },
    config: {
      command: "pi",
      model: "google/gemini-test",
      ...adapterConfig,
    },
    context: {
      taskId: "issue-1",
      projectId: "project-1",
      paperclipWorkspace: { cwd: workspace, source: "project_primary" },
    },
    authToken: "host-only-secret",
    onLog: async () => {},
  });

  const call = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [
    unknown,
    unknown,
    string,
    string[],
    { env: Record<string, string> },
  ];
  return call[4];
}

function capturedArgs(): string[] {
  const call = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [
    unknown,
    unknown,
    string,
    string[],
  ];
  return call[3];
}

describe("pi_local bridge invocation", () => {
  it("uses only the explicit bridge extension without a child bearer", async () => {
    const processOptions = await executeFixture({
      paperclipToolBridge: {
        toolNames: ["ajanderson.journal-wiki:begin_operation"],
      },
    });
    const args = capturedArgs();

    expect(args).toEqual(expect.arrayContaining([
      "--no-builtin-tools",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
      "--extension",
      expect.stringContaining("paperclip-tool-bridge"),
    ]));
    expect(args).not.toContain("bash");
    expect(processOptions.env.PAPERCLIP_API_KEY).toBeUndefined();
  });

  it("keeps the existing tool set when bridge mode is absent", async () => {
    await executeFixture({});

    expect(capturedArgs()).toEqual(expect.arrayContaining([
      "--tools",
      "read,bash,edit,write,grep,find,ls",
    ]));
  });
});
