import type { AiConfig } from './config.ts';

export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface AiProvider {
  readonly id: string;
  complete(req: AiRequest, signal?: AbortSignal): Promise<string>;
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic';
  private cfg: AiConfig;
  private apiKey: string;
  constructor(cfg: AiConfig, apiKey: string) {
    this.cfg = cfg;
    this.apiKey = apiKey;
  }
  async complete(req: AiRequest, signal?: AbortSignal): Promise<string> {
    const base = this.cfg.baseUrl ?? 'https://api.anthropic.com';
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.cfg.model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: 'user', content: req.user }] }),
      signal: signal ?? AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  }
}

/** OpenAI-compatible (OpenAI, Gemini OpenAI-compat endpoint, Ollama/llama.cpp, vLLM...) */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai-compatible';
  private cfg: AiConfig;
  private apiKey: string;
  constructor(cfg: AiConfig, apiKey: string) {
    this.cfg = cfg;
    this.apiKey = apiKey;
  }
  async complete(req: AiRequest, signal?: AbortSignal): Promise<string> {
    const base = (this.cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.cfg.model, max_tokens: req.maxTokens, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }] }),
      signal: signal ?? AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? '';
  }
}

export function createProvider(cfg: AiConfig, env: NodeJS.ProcessEnv = process.env): AiProvider {
  const key = env[cfg.apiKeyEnv] ?? '';
  return cfg.provider === 'anthropic' ? new AnthropicProvider(cfg, key) : new OpenAiCompatibleProvider(cfg, key);
}
