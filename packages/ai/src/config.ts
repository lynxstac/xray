import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ProviderId = 'anthropic' | 'openai-compatible';

export interface AiConfig {
  provider: ProviderId;
  model: string;
  /** API kalit shu env o'zgaruvchidan o'qiladi (fayl ichida saqlanmaydi) */
  apiKeyEnv: string;
  baseUrl?: string;
  consent?: {
    acceptedAt: string;
    /** Foydalanuvchi rozilik bergan provayder; boshqasiga o'tilsa rozilik qayta so'raladi */
    provider: ProviderId;
    sendsSourceExcerpts: true;
  };
}

import { DEFAULT_LANG, t, type Lang } from '@xray/core';

export class AiDisabledError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AiDisabledError';
  }
}

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.config', 'xray', 'ai.json');

export async function loadAiConfig(file = process.env.XRAY_AI_CONFIG ?? DEFAULT_CONFIG_PATH): Promise<AiConfig | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as AiConfig;
  } catch {
    return null;
  }
}

export async function saveAiConfig(cfg: AiConfig, file = process.env.XRAY_AI_CONFIG ?? DEFAULT_CONFIG_PATH): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

/** AI chaqiruvi uchun hamma shart bajarilganmi? Aks holda sababini tushuntiradi. */
export function assertAiEnabled(cfg: AiConfig | null, env: NodeJS.ProcessEnv = process.env, lang: Lang = DEFAULT_LANG): AiConfig {
  if (!cfg) throw new AiDisabledError(t(lang, 'ai.notConfigured'));
  if (!cfg.consent) throw new AiDisabledError(t(lang, 'ai.noConsent'));
  if (cfg.consent.provider !== cfg.provider) throw new AiDisabledError(t(lang, 'ai.consentMismatch', { was: cfg.consent.provider, now: cfg.provider }));
  if (!env[cfg.apiKeyEnv]) throw new AiDisabledError(t(lang, 'ai.noKey', { env: cfg.apiKeyEnv }));
  return cfg;
}

export const CONSENT_TEXT = (p: ProviderId, lang: Lang = DEFAULT_LANG) => t(lang, 'ai.consent', { p });
