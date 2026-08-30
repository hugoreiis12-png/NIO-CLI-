/**
 * Edge Filter  primeira triagem de toda request que chega no `nio-gateway`,
 * antes de qualquer rota. 
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Shape mínimo de request que o filtro precisa — não o `IncomingMessage` inteiro, pra ser testável com objeto simples. */
export interface FilterableRequest {
  headers: IncomingMessage['headers'];
  method?: string;
  url?: string;
}

export interface RequestContext {
  traceId: string;
  method: string;
  path: string;
}

/** Monta o contexto da request reaproveita `x-nio-trace-id` se já veio de um hop anterior (ex.: Kong/Edge Filter externo). */
export function buildContext(req: FilterableRequest): RequestContext {
  const traceHeader = req.headers['x-nio-trace-id'];
  const traceId = (Array.isArray(traceHeader) ? traceHeader[0] : traceHeader) || randomUUID();
  return {
    traceId,
    method: req.method ?? 'UNKNOWN',
    path: (req.url ?? '/').split('?')[0]!,
  };
}

/** Log estruturado em stderr — uma linha JSON por request (`event: 'gateway_request'`). */
export function logRequest(ctx: RequestContext, extra: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'gateway_request', ...ctx, ...extra }));
}

/**
 * Trilha auditável de auth (exigência ANPD/NIST): quem/quando/resultado de cada
 * tentativa de login/2FA. Só metadados — **nunca** a senha ou o código OTP.
 * `result` ∈ password_ok|password_fail|2fa_sent|2fa_ok|2fa_fail|2fa_expired.
 */
export function logAuthEvent(
  ctx: RequestContext,
  result: string,
  meta: { name?: string; userId?: number; reason?: string } = {},
): void {
  console.error(
    JSON.stringify({ ts: new Date().toISOString(), event: 'auth_attempt', result, ...ctx, ...meta }),
  );
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : null;
}

/** `true` se a request carrega header `Origin` — só browser manda isso; CLI/curl nunca mandam. */
export function hasBrowserOrigin(req: FilterableRequest): boolean {
  return firstHeaderValue(req.headers.origin) !== null;
}

/** Extrai o token do header `x-nio-gateway-token`. `null` se ausente. */
export function extractGatewayToken(req: FilterableRequest): string | null {
  return firstHeaderValue(req.headers['x-nio-gateway-token']);
}

/** Compara em tempo constante — evita vazar o token por diferença de latência. */
export function tokensMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Lê o corpo da request como JSON. Throw com mensagem acionável se exceder o limite ou não for JSON válido. */
export async function readJsonBody<T>(req: IncomingMessage, maxBytes = 1_000_000): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('corpo da request excede o limite permitido');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('corpo da request não é JSON válido');
  }
}
