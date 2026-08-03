import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9.-]*:[a-z][a-z0-9_-]*$/;
const MAX_REQUEST_BYTES = 64 * 1024;

type RecordValue = Record<string, unknown>;

export type PaperclipToolBridgeConfig = {
  toolNames: string[];
};

export type PaperclipToolBridgeRunContext = {
  companyId: string;
  agentId: string;
  projectId: string;
  runId: string;
  issueId: string;
};

type ForwardRequest = {
  tool: string;
  parameters: RecordValue;
  runContext: PaperclipToolBridgeRunContext;
};

type ForwardResponse = {
  status: number;
  body: unknown;
};

type Forward = (request: ForwardRequest) => Promise<ForwardResponse>;

export type StartPaperclipToolBridgeInput = {
  hostApiToken: string;
  hostApiUrl: string;
  runContext: PaperclipToolBridgeRunContext;
  toolNames: string[];
  forward?: Forward;
};

export type PaperclipToolBridgeHandle = {
  url: string;
  capability: string;
  stop(): Promise<void>;
};

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function normalizeHostApiUrl(value: string): string {
  const base = requireNonEmptyString(value, "hostApiUrl").replace(/\/+$/, "");
  return base.endsWith("/api") ? base.slice(0, -4) : base;
}

function capabilityMatches(value: string | undefined, expected: string): boolean {
  const prefix = "Bearer ";
  if (!value?.startsWith(prefix)) return false;
  const received = Buffer.from(value.slice(prefix.length));
  const expectedBuffer = Buffer.from(expected);
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
}

function writeJson(response: ServerResponse, status: number, body: RecordValue): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<RecordValue | null> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) return null;
    chunks.push(buffer);
  }

  try {
    return asRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    return null;
  }
}

function assertRunContext(value: PaperclipToolBridgeRunContext): void {
  requireNonEmptyString(value.companyId, "runContext.companyId");
  requireNonEmptyString(value.agentId, "runContext.agentId");
  requireNonEmptyString(value.projectId, "runContext.projectId");
  requireNonEmptyString(value.runId, "runContext.runId");
  requireNonEmptyString(value.issueId, "runContext.issueId");
}

function requireToolRequest(value: RecordValue): { tool: string; parameters: RecordValue } | null {
  const tool = value.tool;
  const parameters = asRecord(value.parameters);
  return typeof tool === "string" && parameters !== null ? { tool, parameters } : null;
}

function defaultForward(input: {
  hostApiToken: string;
  hostApiUrl: string;
}): Forward {
  return async ({ tool, parameters, runContext }) => {
    const response = await fetch(`${normalizeHostApiUrl(input.hostApiUrl)}/api/plugins/tools/execute`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.hostApiToken}`,
        "content-type": "application/json",
        "x-paperclip-run-id": runContext.runId,
      },
      body: JSON.stringify({ tool, parameters, runContext }),
      signal: AbortSignal.timeout(30_000),
    });

    let body: unknown = null;
    if (response.ok) {
      try {
        body = await response.json();
      } catch {
        return { status: 502, body: null };
      }
    }
    return { status: response.status, body };
  };
}

export function parsePaperclipToolBridgeConfig(
  value: unknown,
): PaperclipToolBridgeConfig | null {
  const config = asRecord(value);
  if (!config || config.paperclipToolBridge === undefined) return null;

  const bridge = asRecord(config.paperclipToolBridge);
  if (!bridge || !Array.isArray(bridge.toolNames) || bridge.toolNames.length === 0) {
    throw new Error("paperclipToolBridge.toolNames must be a non-empty array");
  }

  const toolNames = bridge.toolNames.map((name) => {
    if (typeof name !== "string" || !TOOL_NAME_PATTERN.test(name)) {
      throw new Error("paperclipToolBridge tool names must be fully namespaced");
    }
    return name;
  });

  if (new Set(toolNames).size !== toolNames.length) {
    throw new Error("paperclipToolBridge tool names must be unique");
  }

  return { toolNames };
}

export async function startPaperclipToolBridge(
  input: StartPaperclipToolBridgeInput,
): Promise<PaperclipToolBridgeHandle> {
  requireNonEmptyString(input.hostApiToken, "hostApiToken");
  normalizeHostApiUrl(input.hostApiUrl);
  assertRunContext(input.runContext);
  const config = parsePaperclipToolBridgeConfig({
    paperclipToolBridge: { toolNames: input.toolNames },
  });
  if (!config) throw new Error("paperclipToolBridge configuration is required");

  const allowedTools = new Set(config.toolNames);
  const capability = randomBytes(32).toString("base64url");
  const forward = input.forward ?? defaultForward(input);
  let stopped = false;

  const server = createServer(async (request, response) => {
    if (stopped) {
      writeJson(response, 410, { error: "Bridge is unavailable." });
      return;
    }
    if (request.method !== "POST" || request.url !== "/invoke") {
      writeJson(response, 404, { error: "Not found." });
      return;
    }
    if (!capabilityMatches(request.headers.authorization, capability)) {
      writeJson(response, 401, { error: "Bridge authentication failed." });
      return;
    }

    const body = await readJsonBody(request);
    const toolRequest = body ? requireToolRequest(body) : null;
    if (!toolRequest) {
      writeJson(response, 400, { error: "Invalid tool request." });
      return;
    }
    if (!allowedTools.has(toolRequest.tool)) {
      writeJson(response, 403, { error: "Tool is not allowed for this run." });
      return;
    }
    if (toolRequest.parameters.issueId !== input.runContext.issueId) {
      writeJson(response, 403, { error: "Tool request does not match this run." });
      return;
    }

    try {
      const result = await forward({
        tool: toolRequest.tool,
        parameters: toolRequest.parameters,
        runContext: input.runContext,
      });
      if (result.status < 200 || result.status >= 300) {
        writeJson(response, 502, { error: "Paperclip tool call failed." });
        return;
      }
      const responseBody = asRecord(result.body);
      if (!responseBody) {
        writeJson(response, 502, { error: "Paperclip tool call failed." });
        return;
      }
      writeJson(response, 200, responseBody);
    } catch {
      writeJson(response, 502, { error: "Paperclip tool call failed." });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Paperclip tool bridge did not bind a loopback port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    capability,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
