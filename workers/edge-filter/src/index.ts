/**
 * Edge Filter — Cloudflare Worker na frente do Gateway de Auth (src/gateway/
 * no repo principal). Responsabilidade: identificar/rastrear quem está
 * entrando (traceability: ip, user-agent, timestamp, trace id) e repassar
 * pro Gateway core. Deliberadamente simples — uso interno.
 *
 * Ver docs/specs/auth/0002-cli-native-login.md.
 */

export interface Env {
  /** Base URL do Gateway core (ex.: https://gateway.interno.example). */
  GATEWAY_URL: string;
}

function traceId(request: Request): string {
  return request.headers.get('x-nio-trace-id') ?? crypto.randomUUID();
}

function logRequest(request: Request, trace: string): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'edge_request',
      traceId: trace,
      ip: request.headers.get('cf-connecting-ip') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
      method: request.method,
      path: new URL(request.url).pathname,
    }),
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const trace = traceId(request);
    logRequest(request, trace);

    if (!env.GATEWAY_URL) {
      return new Response(JSON.stringify({ error: 'gateway_not_configured' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, env.GATEWAY_URL);

    const forwarded = new Request(target.toString(), request);
    forwarded.headers.set('x-nio-trace-id', trace);
    forwarded.headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');

    return fetch(forwarded);
  },
};
