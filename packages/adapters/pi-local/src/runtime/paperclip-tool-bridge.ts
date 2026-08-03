type BridgeManifestEntry = {
  name: string;
};

type BridgeInvocation = {
  tool: string;
  parameters: Record<string, unknown>;
};

type BridgeClient = {
  requestManifest(): Promise<BridgeManifestEntry[]>;
  invoke(request: BridgeInvocation): Promise<unknown>;
};

type PiTool = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(toolCallId: string, parameters: Record<string, unknown>): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
  }>;
};

type PiExtensionApi = {
  registerTool(tool: PiTool): void;
};

export function paperclipToolBridgeAlias(name: string): string {
  const [plugin, action] = name.split(":");
  if (!plugin || !action) throw new Error("Bridge manifest contains an invalid tool name");
  const pluginSlug = plugin.split(".").at(-1)?.replace(/-wiki$/, "");
  if (!pluginSlug) throw new Error("Bridge manifest contains an invalid plugin name");
  return `${pluginSlug}_${action}`.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

function stringifyResult(result: unknown): string {
  try {
    return JSON.stringify(result);
  } catch {
    return "Bridge returned an unreadable result.";
  }
}

export async function registerBridgeTools(
  pi: PiExtensionApi,
  client: BridgeClient,
): Promise<void> {
  const manifest = await client.requestManifest();
  const aliases = new Set<string>();

  for (const entry of manifest) {
    const alias = paperclipToolBridgeAlias(entry.name);
    if (aliases.has(alias)) {
      throw new Error(`Bridge tool alias collision: ${alias}`);
    }
    aliases.add(alias);
    const toolName = entry.name;
    pi.registerTool({
      name: alias,
      label: alias.replace(/_/g, " "),
      description: "Invoke the explicitly allowed Paperclip capability.",
      parameters: {
        type: "object",
        additionalProperties: true,
      },
      async execute(_toolCallId, parameters) {
        try {
          const result = await client.invoke({ tool: toolName, parameters });
          return {
            content: [{ type: "text", text: stringifyResult(result) }],
            details: { tool: toolName },
          };
        } catch {
          return {
            content: [{ type: "text", text: "Paperclip capability invocation failed." }],
            details: { tool: toolName },
          };
        }
      },
    });
  }
}

function requireBridgeEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Paperclip bridge configuration is unavailable");
  return value;
}

function bridgeClientFromEnvironment(): BridgeClient {
  const url = requireBridgeEnvironment("PAPERCLIP_TOOL_BRIDGE_URL");
  const capability = requireBridgeEnvironment("PAPERCLIP_TOOL_BRIDGE_CAPABILITY");
  const headers = {
    authorization: `Bearer ${capability}`,
    "content-type": "application/json",
  };

  return {
    async requestManifest() {
      const response = await fetch(`${url}/manifest`, { headers });
      if (!response.ok) throw new Error("Bridge manifest is unavailable");
      const body = await response.json() as unknown;
      if (!Array.isArray(body) || !body.every((entry) => entry && typeof entry === "object" && typeof (entry as BridgeManifestEntry).name === "string")) {
        throw new Error("Bridge manifest is invalid");
      }
      return body as BridgeManifestEntry[];
    },
    async invoke(request) {
      const response = await fetch(`${url}/invoke`, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error("Bridge invocation failed");
      return response.json();
    },
  };
}

export default async function paperclipToolBridgeExtension(pi: PiExtensionApi): Promise<void> {
  await registerBridgeTools(pi, bridgeClientFromEnvironment());
}
