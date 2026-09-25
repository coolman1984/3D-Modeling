import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { runApiAgent } from './apiAgent.js';
import { agentPrompt } from './prompt.js';
import { loadSettings, type CliAgentSettings } from './settings.js';
import type { AgentRun, Store } from './store.js';
import { runTool, toolSummaries } from './tools.js';

export interface AgentRunnerOptions {
  readonly store: Store;
  /** Where each run gets its own working folder (agents never work inside the app's source). */
  readonly dataDir: string;
  /** The MCP bridge script agents start to reach the planner tools. */
  readonly mcpScript: string;
  /** Base URL of this server, handed to the MCP bridge. */
  readonly url: () => string;
}

export interface AgentAvailability {
  readonly id: string;
  readonly label: string;
  readonly kind: 'cli' | 'api';
  readonly available: boolean;
  readonly detail: string;
}

/** Find a program on PATH the way a shell would (including .cmd/.exe on Windows). */
export function findProgram(name: string): string | null {
  if (isAbsolute(name)) return existsSync(name) ? name : null;
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of process.platform === 'win32' ? ['', ...exts] : exts) {
      const candidate = join(dir, name + ext);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/** Quote one argument for cmd.exe, used only for .cmd/.bat launchers on Windows. */
function quoteForCmd(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/**
 * Starts and supervises agent runs. Coding agents run as local programs that reach the
 * planner through the MCP bridge; the API agent runs inside this server. Either way every
 * change goes through the same tools and lands in the history under the agent's name.
 */
export class AgentRunner {
  private readonly active = new Map<string, { stop: () => void }>();

  constructor(private readonly options: AgentRunnerOptions) {}

  availability(): AgentAvailability[] {
    const settings = loadSettings(this.options.store);
    const cli = Object.entries(settings.agents).map(([id, agent]) => {
      const program = agent.command[0] ?? '';
      const found = findProgram(program);
      return {
        id,
        label: agent.label,
        kind: 'cli' as const,
        available: Boolean(found),
        detail: found ?? `مش لاقي البرنامج "${program}" على الجهاز`,
      };
    });
    const api = settings.api;
    const configured = api.provider === 'anthropic' ? Boolean(api.apiKey || process.env.ANTHROPIC_API_KEY) : Boolean(api.baseUrl);
    return [
      ...cli,
      {
        id: 'api',
        label: api.provider === 'anthropic' ? `واجهة Claude (${api.model})` : `واجهة متوافقة (${api.model})`,
        kind: 'api',
        available: configured,
        detail: configured ? 'جاهز' : 'محتاج مفتاح أو عنوان في الإعدادات',
      },
    ];
  }

  isRunning(runId: string): boolean {
    return this.active.has(runId);
  }

  start(projectId: string, agentId: string, specification: string): AgentRun {
    const { store } = this.options;
    const settings = loadSettings(store);
    const prompt = agentPrompt(projectId, specification);
    const run = store.createRun(projectId, agentId, specification);
    const log = (line: string) => store.appendRunLog(run.id, line);
    const timeout = setTimeout(() => {
      log(`اتوقف بعد ${settings.timeoutMinutes} دقيقة.`);
      this.stop(run.id);
    }, settings.timeoutMinutes * 60_000);
    const finish = (status: 'done' | 'failed' | 'stopped') => {
      clearTimeout(timeout);
      this.active.delete(run.id);
      store.finishRun(run.id, status);
    };

    if (agentId === 'api') {
      const controller = new AbortController();
      let stopped = false;
      this.active.set(run.id, {
        stop: () => {
          stopped = true;
          controller.abort();
        },
      });
      const actor = `agent:api:${settings.api.model}`;
      runApiAgent({
        settings: settings.api,
        tools: toolSummaries(),
        execute: (name, input) => runTool({ store, actor }, name, input),
        prompt,
        log,
        signal: controller.signal,
      })
        .then((status) => finish(stopped ? 'stopped' : status))
        .catch((error: unknown) => {
          log(`خطأ: ${error instanceof Error ? error.message : String(error)}`);
          finish(stopped ? 'stopped' : 'failed');
        });
      return run;
    }

    const agent: CliAgentSettings | undefined = settings.agents[agentId];
    if (!agent || agent.command.length === 0) {
      log(`الوكيل "${agentId}" مش متعرّف في الإعدادات.`);
      finish('failed');
      return store.getRun(run.id) ?? run;
    }

    const workDir = join(this.options.dataDir, 'runs', run.id);
    mkdirSync(workDir, { recursive: true });
    const actor = `agent:${agentId}`;
    const url = this.options.url();
    const mcpConfig = join(workDir, 'mcp.json');
    writeFileSync(
      mcpConfig,
      JSON.stringify(
        { mcpServers: { planner: { command: process.execPath, args: [this.options.mcpScript, '--url', url, '--actor', actor] } } },
        null,
        2,
      ),
    );
    const values: Record<string, string> = {
      prompt,
      mcpConfig,
      node: process.execPath.replace(/\\/g, '/'),
      mcpScript: this.options.mcpScript.replace(/\\/g, '/'),
      url,
      actor,
      projectId,
      workDir,
    };
    const fill = (arg: string) => arg.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
    const [program, ...rawArgs] = agent.command.map(fill);
    const resolved = findProgram(program!);
    if (!resolved) {
      log(`مش لاقي "${program}" على الجهاز. ثبّته أو عدّل الأمر في الإعدادات.`);
      finish('failed');
      return store.getRun(run.id) ?? run;
    }

    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
    let child: ChildProcess;
    try {
      child = spawn(needsShell ? quoteForCmd(resolved) : resolved, needsShell ? rawArgs.map(quoteForCmd) : rawArgs, {
        cwd: workDir,
        env: { ...process.env, PLANNER_URL: url, PLANNER_PROJECT: projectId, PLANNER_ACTOR: actor },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: needsShell,
        windowsHide: true,
      });
    } catch (error) {
      log(`تعذر التشغيل: ${error instanceof Error ? error.message : String(error)}`);
      finish('failed');
      return store.getRun(run.id) ?? run;
    }

    let stopped = false;
    this.active.set(run.id, {
      stop: () => {
        stopped = true;
        child.kill();
      },
    });
    log(`▶ ${agent.label}`);
    const lines = (stream: NodeJS.ReadableStream | null, handle: (line: string) => void) => {
      let buffer = '';
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, '');
          buffer = buffer.slice(index + 1);
          if (line.trim()) handle(line);
        }
      });
      stream?.on('end', () => buffer.trim() && handle(buffer.trim()));
    };
    lines(child.stdout, (line) => {
      const readable = readableAgentLine(line);
      if (readable) log(readable);
    });
    lines(child.stderr, (line) => log(`⚠ ${line}`));
    child.on('error', (error) => log(`تعذر التشغيل: ${error.message}`));
    child.on('close', (code) => finish(stopped ? 'stopped' : code === 0 ? 'done' : 'failed'));
    child.stdin?.on('error', () => undefined);
    if (agent.promptOnStdin) child.stdin?.end(prompt);
    else child.stdin?.end();
    return run;
  }

  stop(runId: string): boolean {
    const active = this.active.get(runId);
    if (!active) return false;
    active.stop();
    return true;
  }

  stopAll(): void {
    for (const id of [...this.active.keys()]) this.stop(id);
  }
}

/**
 * Turn one line of agent output into something a person can follow. Claude Code's
 * stream-json events become short lines; anything else is shown as is.
 */
export function readableAgentLine(line: string): string | null {
  if (!line.startsWith('{')) return line;
  let event: { type?: string; subtype?: string; message?: { content?: Array<{ type: string; text?: string; name?: string }> }; result?: string };
  try {
    event = JSON.parse(line) as typeof event;
  } catch {
    return line;
  }
  if (event.type === 'assistant') {
    const parts = (event.message?.content ?? []).map((c) =>
      c.type === 'text' ? (c.text ?? '').trim() : c.type === 'tool_use' ? `🔧 ${(c.name ?? '').replace(/^mcp__planner__/, '')}` : '',
    );
    return parts.filter(Boolean).join('\n') || null;
  }
  if (event.type === 'result') return event.subtype === 'success' ? '✔ خلص' : `✖ ${event.subtype ?? 'انتهى'}`;
  return null;
}
