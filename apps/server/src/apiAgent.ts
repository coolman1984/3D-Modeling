import Anthropic from '@anthropic-ai/sdk';
import type { ApiAgentSettings } from './settings.js';

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ApiAgentRun {
  readonly settings: ApiAgentSettings;
  readonly tools: readonly AgentTool[];
  readonly execute: (name: string, input: unknown) => { text: string; isError: boolean };
  readonly prompt: string;
  readonly log: (line: string) => void;
  readonly signal: AbortSignal;
  readonly maxTurns?: number;
}

/** Runs a tool-use loop against the configured API until the model stops calling tools. */
export async function runApiAgent(run: ApiAgentRun): Promise<'done' | 'failed'> {
  if (!run.settings.apiKey && run.settings.provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    run.log('لم يتم ضبط مفتاح الخدمة. افتح الإعدادات وأضف المفتاح.');
    return 'failed';
  }
  return run.settings.provider === 'anthropic' ? runAnthropic(run) : runOpenAiCompatible(run);
}

/** Models that accept the server-side refusal fallback chain. */
function supportsFallbacks(model: string): boolean {
  return model === 'claude-opus-5' || model === 'claude-opus-5-5' || model.startsWith('claude-fable-5');
}

async function runAnthropic(run: ApiAgentRun): Promise<'done' | 'failed'> {
  const { settings } = run;
  const client = new Anthropic({
    ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
    ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
  });
  const tools: Anthropic.Beta.BetaTool[] = run.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Beta.BetaTool['input_schema'],
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: run.prompt }];
  const isHaiku = settings.model.includes('haiku');

  for (let turn = 0; turn < (run.maxTurns ?? 60); turn++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create(
        {
          model: settings.model,
          max_tokens: 16000,
          tools,
          messages,
          ...(isHaiku ? {} : { thinking: { type: 'adaptive' as const }, output_config: { effort: 'high' as const } }),
          ...(supportsFallbacks(settings.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: run.signal },
      );
    } catch (error) {
      if (run.signal.aborted) return 'failed';
      if (error instanceof Anthropic.AuthenticationError) run.log('المفتاح مرفوض من الخدمة (تأكد منه في الإعدادات).');
      else if (error instanceof Anthropic.RateLimitError) run.log('الخدمة مشغولة أو الحد اتخطى؛ جرّب بعد شوية.');
      else if (error instanceof Anthropic.APIError) run.log(`خطأ من الخدمة ${error.status ?? ''}: ${error.message}`);
      else run.log(`تعذر الاتصال بالخدمة: ${error instanceof Error ? error.message : String(error)}`);
      return 'failed';
    }

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) run.log(block.text.trim());
    }

    if (response.stop_reason === 'refusal') {
      run.log('النموذج رفض يكمل الطلب ده.');
      return 'failed';
    }
    if (response.stop_reason === 'max_tokens') {
      run.log('الرد وقف لأنه طويل جدًا.');
      return 'failed';
    }
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || calls.length === 0) return 'done';

    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = calls.map((call) => {
      run.log(`🔧 ${call.name}`);
      const result = run.execute(call.name, call.input);
      if (result.isError) run.log(`  ⚠ ${result.text.split('\n')[0]}`);
      return { type: 'tool_result', tool_use_id: call.id, content: result.text, is_error: result.isError };
    });
    messages.push({ role: 'user', content: results });
  }
  run.log('وصل لأقصى عدد خطوات ووقف.');
  return 'failed';
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/** Any server that speaks the OpenAI chat-completions format with function tools. */
async function runOpenAiCompatible(run: ApiAgentRun): Promise<'done' | 'failed'> {
  const { settings } = run;
  if (!settings.baseUrl) {
    run.log('اكتب عنوان الخدمة في الإعدادات (مثال: http://localhost:11434/v1).');
    return 'failed';
  }
  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const tools = run.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const messages: ChatMessage[] = [{ role: 'user', content: run.prompt }];

  for (let turn = 0; turn < (run.maxTurns ?? 60); turn++) {
    let body: { choices?: Array<{ message?: ChatMessage; finish_reason?: string }>; error?: { message?: string } };
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}) },
        body: JSON.stringify({ model: settings.model, messages, tools }),
        signal: run.signal,
      });
      body = (await response.json()) as typeof body;
      if (!response.ok) {
        run.log(`خطأ من الخدمة ${response.status}: ${body.error?.message ?? ''}`);
        return 'failed';
      }
    } catch (error) {
      if (run.signal.aborted) return 'failed';
      run.log(`تعذر الاتصال بالخدمة: ${error instanceof Error ? error.message : String(error)}`);
      return 'failed';
    }
    const message = body.choices?.[0]?.message;
    if (!message) {
      run.log('رد غير مفهوم من الخدمة.');
      return 'failed';
    }
    if (message.content?.trim()) run.log(message.content.trim());
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) return 'done';
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      run.log(`🔧 ${call.function.name}`);
      let input: unknown = {};
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: arguments were not valid JSON' });
        continue;
      }
      const result = run.execute(call.function.name, input);
      if (result.isError) run.log(`  ⚠ ${result.text.split('\n')[0]}`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.text });
    }
  }
  run.log('وصل لأقصى عدد خطوات ووقف.');
  return 'failed';
}
