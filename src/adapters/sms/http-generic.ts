/**
 * Adapter de SMS genérico via HTTP — pluga qualquer provedor por env, sem código
 * novo. `POST` num endpoint configurável, com header de auth e corpo template.
 */
import type { SmsResult, SmsSender } from '../../core/messaging.js';

/** `"Nome: valor"` → `{ Nome: "valor" }`, ou `{}` se malformado. */
export function parseAuthHeader(line: string | undefined): Record<string, string> {
  if (!line) return {};
  const i = line.indexOf(':');
  if (i < 1) return {};
  return { [line.slice(0, i).trim()]: line.slice(i + 1).trim() };
}

/** Substitui `{to}`/`{text}`/`{from}` no template (valores JSON-escapados). */
export function renderBody(
  template: string,
  vars: { to: string; text: string; from?: string },
): string {
  const esc = (s: string) => JSON.stringify(s).slice(1, -1);
  return template
    .split('{to}').join(esc(vars.to))
    .split('{text}').join(esc(vars.text))
    .split('{from}').join(esc(vars.from ?? ''));
}

interface SmsEnv {
  url?: string;
  authHeader?: string;
  bodyTemplate?: string;
  from?: string;
}

function readEnv(): SmsEnv {
  return {
    url: process.env.SMS_ENDPOINT_URL?.trim(),
    authHeader: process.env.SMS_AUTH_HEADER?.trim(),
    bodyTemplate: process.env.SMS_BODY_TEMPLATE?.trim(),
    from: process.env.SMS_FROM?.trim(),
  };
}

/**
 * `echo` — endpoint em loopback (o mock `scripts/sms-echo.ts`): NENHUM SMS real
 * sai; o código só aparece no terminal do mock / `~/.nio/sms-echo-last.json`.
 * `provider` — endpoint externo. `unconfigured` — sem `SMS_*` (2FA indisponível).
 */
export type SmsMode = 'echo' | 'provider' | 'unconfigured';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** Classifica o backend de SMS ativo — a CLI usa pra avisar que está em modo echo. */
export function smsMode(env: SmsEnv = readEnv()): SmsMode {
  if (!env.url || !env.bodyTemplate) return 'unconfigured';
  try {
    return LOOPBACK_HOSTS.has(new URL(env.url).hostname) ? 'echo' : 'provider';
  } catch {
    return 'provider'; // URL malformada → deixa o send() reportar a falha
  }
}

/** Host do provedor de SMS (sem esquema/porta/caminho), pra exibir no `status`. `null` se não configurado/inválido. */
export function smsProviderHost(env: SmsEnv = readEnv()): string | null {
  if (!env.url) return null;
  try {
    return new URL(env.url).hostname;
  } catch {
    return null;
  }
}

/** SMS via HTTP genérico. `env` é seam opcional (default = `process.env`). */
export function createHttpSmsSender(env: SmsEnv = readEnv()): SmsSender {
  return {
    async send(to: string, text: string): Promise<SmsResult> {
      if (!env.url || !env.bodyTemplate) {
        return { status: 'skipped', error: 'SMS_ENDPOINT_URL / SMS_BODY_TEMPLATE não configurados' };
      }
      const body = renderBody(env.bodyTemplate, { to, text, from: env.from });
      try {
        const res = await fetch(env.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...parseAuthHeader(env.authHeader) },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 300);
          return { status: 'failed', error: `provedor respondeu ${res.status} ${detail}`.trim() };
        }
        return { status: 'sent' };
      } catch (err) {
        return { status: 'failed', error: (err as Error).message };
      }
    },
  };
}
