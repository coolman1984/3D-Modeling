/**
 * MCP bridge (stdio). Claude Code, Codex or any MCP client starts this program; it forwards
 * tool calls to the running Space Planner app, so every change shows up live and in the history.
 *
 *   node apps/server/dist/mcp.mjs [--url http://127.0.0.1:4600] [--actor agent:claude-code]
 *
 * Without --url it reads the address the app wrote to data/server.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface BridgeOptions {
  readonly url: string;
  readonly actor: string;
  readonly fetchImpl?: typeof fetch;
}

/** Handle one JSON-RPC message; returns the response, or null for notifications. */
export async function handleMessage(message: JsonRpcRequest, options: BridgeOptions): Promise<object | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id ?? null, result });
  const fail = (code: number, text: string) => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code, message: text } });
  if (message.id === undefined || message.id === null) return null; // notification

  switch (message.method) {
    case 'initialize': {
      const asked = String(message.params?.protocolVersion ?? '');
      return reply({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'space-planner', version: '1.0.0' },
        instructions:
          'Space Planner tools. Start with list_projects / get_project. Lengths are metres or cm as named; x east, y north; rotation degrees counter-clockwise (0 = front faces north).',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list': {
      try {
        const response = await doFetch(`${options.url}/api/tools`);
        const tools = (await response.json()) as Array<{ name: string; description: string; inputSchema: object }>;
        return reply({ tools });
      } catch {
        return fail(-32000, `Space Planner is not running at ${options.url}. Start it with the start file in the project folder.`);
      }
    }
    case 'tools/call': {
      const name = String(message.params?.name ?? '');
      try {
        const response = await doFetch(`${options.url}/api/tools/${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: message.params?.arguments ?? {}, actor: options.actor }),
        });
        const result = (await response.json()) as { text: string; isError: boolean };
        return reply({ content: [{ type: 'text', text: result.text }], isError: result.isError });
      } catch {
        return reply({
          content: [{ type: 'text', text: `Space Planner is not running at ${options.url}. Start it with the start file in the project folder.` }],
          isError: true,
        });
      }
    }
    default:
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function discoverUrl(): string {
  const fromArgs = argument('--url') ?? process.env.PLANNER_URL;
  if (fromArgs) return fromArgs.replace(/\/+$/, '');
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = argument('--data') ?? process.env.PLANNER_DATA ?? join(here, '..', '..', '..', 'data');
  const file = join(dataDir, 'server.json');
  if (existsSync(file)) {
    try {
      const info = JSON.parse(readFileSync(file, 'utf8')) as { url?: string };
      if (info.url) return info.url;
    } catch {
      // fall through to the default
    }
  }
  return 'http://127.0.0.1:4600';
}

function main(): void {
  const options: BridgeOptions = {
    url: discoverUrl(),
    actor: argument('--actor') ?? process.env.PLANNER_ACTOR ?? 'agent:mcp',
  };
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(line) as JsonRpcRequest;
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    void handleMessage(message, options).then((response) => {
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
