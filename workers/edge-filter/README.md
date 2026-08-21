# Edge Filter (Cloudflare Worker)

Camada na frente do Gateway de Auth (`src/gateway/` no repo principal):
registra traceability (ip, user-agent, timestamp, trace id) de cada
requisição e repassa pro Gateway. Ver `docs/specs/auth/0002-cli-native-login.md`.

## Deploy

Precisa de uma conta Cloudflare com Workers habilitado.

```bash
cd workers/edge-filter
npm install
npx wrangler login          # autentica com sua conta Cloudflare
```

Edite `wrangler.toml` e defina `GATEWAY_URL` pra onde o Gateway
(`src/gateway/server.ts`) estiver hospedado e acessível pela internet.

```bash
npx wrangler dev             # roda local, aponta pro GATEWAY_URL configurado
npx wrangler deploy          # publica o Worker
```

## Limitações desta etapa

- `GATEWAY_URL` só aceita HTTP simples — sem retry, sem circuit breaker.
- Traceability é só `console.log` (Cloudflare captura como Worker Logs) —
  sem persistência própria ainda.
- Sem rate limiting nem allowlist de origem — uso interno por enquanto.
