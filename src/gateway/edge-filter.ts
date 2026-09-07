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
  // TP-6: o header vem do cliente (até `maxHeaderSize`, ~16 KB) e é gravado
  // verbatim em `auth_events.trace_id` — cap em 64 chars.
  const traceId = (Array.isArray(traceHeader) ? traceHeader[0] : traceHeader)?.slice(0, 64) || randomUUID();
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

/**
 * IP do cliente (auditoria de login — ADR 0011 §F). Default: o peer da conexão
 * (`socket.remoteAddress`). Com `NIO_TRUST_PROXY=1`: o 1º valor de
 * `X-Forwarded-For` — **só ligue isso quando o Kong for a ÚNICA entrada do
 * gateway** (senão qualquer um forja o header). Normaliza IPv4-mapeado.
 */
export function clientIp(req: FilterableRequest & { socket?: { remoteAddress?: string } }): string | null {
  let ip: string | null = null;
  const trust = /^(1|true|yes|on)$/i.test((process.env.NIO_TRUST_PROXY ?? '').trim());
  if (trust) {
    const xff = firstHeaderValue(req.headers['x-forwarded-for']);
    if (xff) ip = xff.split(',')[0]!.trim() || null;
  }
  ip ??= req.socket?.remoteAddress ?? null;
  return ip ? ip.replace(/^::ffff:/, '') : null;
}

/** Compara em tempo constante — evita vazar o token por diferença de latência. */
export function tokensMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Erro cuja mensagem PODE voltar pro cliente (input inválido). Qualquer outra
 * exceção no handler é interna e vira uma resposta genérica (auditoria L-3).
 */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** Lê o corpo da request como JSON. Throw com mensagem acionável se exceder o limite ou não for JSON válido. */
export async function readJsonBody<T>(req: IncomingMessage, maxBytes = 1_000_000): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new BadRequestError('corpo da request excede o limite permitido');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BadRequestError('corpo da request não é JSON válido');
  }
}
