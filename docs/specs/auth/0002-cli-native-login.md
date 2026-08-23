---
id: "0002"
title: Auth nativa na CLI — Gateway + Edge Filter, OAuth2/PKCE
area: auth
status: superseded
created: 2026-07-26
issue:
---

# Auth nativa na CLI — Gateway + Edge Filter, OAuth2/PKCE

## Problema
Hoje o `nio login`/`nio init` pede o **PAT** ao usuário e imprime a instrução
"gere um token pessoal em `https://nos.noclaf.com.br/profile#mcp`" — o token em
si é validado direto contra o backend (`exchangePatForJwt`, via Supabase), mas
a **geração** do PAT só acontece nesse site. O rebrand (spec 0005) exige
desacoplar a CLI desse domínio e da própria integração com o Supabase.

## Solução
Um **Gateway de Auth** próprio, em duas camadas, construído inteiramente
neste repo:

1. **Edge Filter** (`workers/edge-filter/`) — Cloudflare Worker na frente do
   Gateway. Registra traceability (ip via `cf-connecting-ip`, user-agent,
   timestamp, trace id) de cada requisição e repassa pro Gateway core.
2. **Gateway core** (`src/gateway/`) — módulo Bun/TypeScript, acionado só no
   fluxo de autenticação. Implementa **OAuth 2.0 Authorization Code Flow com
   PKCE (RFC 7636)**: `GET/POST /authorize` (o usuário confirma no navegador)
   e `POST /token` (a CLI troca o code + verifier por um token de sessão).

**Sem Supabase.** A verificação de identidade nesta etapa inicial é
**self-asserted** (o usuário informa o email no formulário do `/authorize`,
sem senha) — decisão explícita do dono do produto: nem permissão nem
verificação forte de credencial entram agora, ficam pra uma iteração
futura. O Gateway não guarda nem verifica senha nenhuma hoje.

Do lado da CLI, a mudança é isolada: `TOKEN_EXCHANGE_URL` (`src/auth.ts`)
passa a apontar pro Gateway quando ele estiver hospedado num lugar
acessível — hoje só roda local (`bun run dev:gateway`).

## Histórias de usuário
1. Como usuário, quero autenticar sem depender de um site com o nome antigo nem de credenciais do Supabase.
2. Como usuário com navegador disponível, quero um fluxo de login que abre uma página, confirmo, e a CLI recebe a sessão sozinha — sem copiar/colar token.
3. Como operador, quero que cada acesso fique rastreado (quem, de onde, quando) mesmo nesta etapa simplificada.
4. Como mantenedor, quero que o fluxo PKCE seja implementado corretamente (code de uso único, `redirect_uri` restrito a loopback, verificação de challenge) mesmo sem verificação de senha ainda — a robustez do protocolo não depende de ter um backend de credencial por trás.

## Escopo
**`src/gateway/`** (Bun, roda fora do build `tsc`/`dist` publicado — ver
Decisões de implementação):
- `GET /authorize` — valida os parâmetros OAuth (`response_type=code`,
  `code_challenge_method=S256`, `redirect_uri` **restrito a loopback**
  `localhost`/`127.0.0.1`, RFC 8252), serve uma página HTML mínima pedindo
  o email.
- `POST /authorize` — recebe o email do formulário, gera um `code` de uso
  único (5min de validade), redireciona pro `redirect_uri` com `code` +
  `state`.
- `POST /token` — troca `{ code, code_verifier, redirect_uri }` por sessão:
  confere PKCE (`SHA256(code_verifier) == code_challenge` salvo no
  `/authorize`), confere `redirect_uri` idêntico, cria a sessão, devolve
  `{ approved, token, expires_in, user }`.
- `POST /auth/validate` — `{ token }` → identidade da sessão, ou reprovado.
- `POST /auth/logout` — encerra a sessão.

**`workers/edge-filter/`** — Worker que loga a requisição e repassa pro
`GATEWAY_URL` configurado.

### Fora de escopo desta spec
- **Deploy real** — nem o Worker nem o Gateway estão hospedados em lugar
  acessível pela internet ainda. Escrevi o código; publicar depende de conta
  Cloudflare (Worker) e de um host pro Gateway (fora do meu alcance aqui).
- **Verificação de senha/identidade forte** — adiada por decisão do dono do
  produto. O `/authorize` aceita qualquer email digitado, sem prova de posse
  (nem confirmação por link, nem senha). **Isto não é uma auth de verdade
  ainda** — é o protocolo OAuth/PKCE correto, com o passo de "provar quem
  você é" propositalmente vazio por enquanto.
- **Permissão/perfil (RBAC)** — não implementado nesta etapa (decisão
  explícita, 2026-07-27). `GatewayUser` só tem `{ id, email }`.
- Integração com o sistema interno NIO (Fase 4 do roadmap) — independente.
- Endurecimento de produção (rate limit, sessão persistida em banco em vez
  de memória do processo, HTTPS termination) — fica pra quando sair do uso
  interno.

## Restrições
- Não regredir o fluxo atual de PAT (spec `0001-identity-cache.md`) até o
  Gateway estar de fato ligado em `TOKEN_EXCHANGE_URL`.
- `stdout` reservado pro JSON-RPC do MCP — logs em stderr.
- `redirect_uri` só loopback (`http://localhost`/`http://127.0.0.1`) — bloqueia
  redirecionar pra qualquer host externo, mesmo sem verificação de senha.
- Code de autorização é **uso único**: consumido no `/token` mesmo que a
  verificação de PKCE falhe depois (evita reuso por tentativa e erro).
- **Sessões vivem em memória do processo do Gateway** — reiniciar derruba
  todo mundo. Aceitável agora (uso interno, um processo só).

## Decisões de implementação
- **Módulo `src/gateway/`:** `types.ts` (shapes), `pkce.ts` (verifier/
  challenge/state, puro), `authorize-store.ts` (codes pendentes, em
  memória, uso único), `authorize-page.ts` (HTML do formulário, puro),
  `sessions.ts` (sessão em memória, 1 ativa por usuário — novo login
  invalida a anterior, mesmo padrão de `start_task_allocation`),
  `traceability.ts` (log estruturado em stderr), `server.ts` (`Bun.serve()`
  com as rotas).
- **Por que fora do `tsc`/`dist`:** `Bun.serve()` é Bun-only; o pacote
  publicado no npm precisa continuar Node-compatível (`engines.node>=20`,
  sem `bun-types`). `tsconfig.json` exclui `src/gateway/**`; o módulo roda
  via `bun run dev:gateway`.
- **Token:** `crypto.randomUUID()`, opaco. Trocar por JWT assinado é upgrade
  futuro se precisar validar sem round-trip no `/auth/validate`.
- **Edge Filter fora de `src/`:** `workers/edge-filter/` tem `wrangler.toml`
  + `package.json` próprios (runtime Cloudflare, não Bun/Node) — por estar
  fora de `src/`, não entra no `tsc` do pacote principal de qualquer forma.
- **Sem dependência nova** no pacote principal: `Bun.serve()` + `fetch`
  nativo, nada de framework HTTP.

## Decisões de teste
- `pkce.test.ts` e `sessions.test.ts`: funções puras, sem rede.
- Fluxo completo (`/authorize` → `/token` → `/auth/validate`) verificado
  manualmente via `curl` end-to-end (GET authorize 200, POST authorize gera
  redirect com code, POST token com verifier certo aprova, reuso do mesmo
  code é rejeitado) — não automatizado ainda como teste de integração.

## Tarefas
- [x] T1 · Direção arquitetural (Gateway + Edge Filter, independente da Fase 4).
- [x] T2 · Perguntas resolvidas (sessão=Fase 2, Gateway substitui Supabase, permissão=perfil, módulo construído aqui).
- [x] T3 · Mecanismo trocado pra OAuth2 Authorization Code + PKCE; Supabase removido; permissão adiada (decisão de 2026-07-27).
- [x] T4 · Módulo `src/gateway/` implementado e testado manualmente ponta a ponta.
- [x] T5 · Edge Filter (`workers/edge-filter/`) escrito.
- [ ] T6 · Deploy do Worker + hospedagem do Gateway em lugar acessível.
- [ ] T7 · `TOKEN_EXCHANGE_URL` repontado; CLI (`nio login`) fala PKCE de ponta a ponta (abre navegador, sobe callback local, troca o code).
- [x] T8 · Testes das partes puras (`pkce`, `sessions`).
- [ ] T9 · Teste de integração automatizado do fluxo completo (hoje só manual via curl).

## Critérios de aceitação
- [x] (T4) `GET /authorize` com parâmetros válidos devolve HTML 200; com `redirect_uri` não-loopback, rejeita.
- [x] (T4) `POST /authorize` gera `code`, redireciona com `code`+`state` pro `redirect_uri`.
- [x] (T4) `POST /token` com verifier correto aprova e devolve token de sessão; com verifier errado ou code reusado, rejeita.
- [x] (T4) Segundo login do mesmo email invalida a sessão anterior.
- [x] (T8) `pkce.ts`: challenge determinístico, sensível ao verifier, formato base64url válido.
- [ ] (T7) `nio login` completa o fluxo sozinho (abre navegador, recebe callback, mostra "autenticado") — pendente de deploy + integração no CLI.

## Registro de decisões
- 2026-07-26: `brand.webUrl` zerado e os dois pontos de uso protegidos
  contra string vazia, como corte mínimo da spec 0005.
- 2026-07-27: Auth não espera a Fase 4 (sistema interno) — Gateway de Auth
  dedicado, independente.
- 2026-07-27: Edge Filter = Cloudflare Worker com traceability; Gateway core
  = módulo neste repo, não serviço separado.
- 2026-07-27: Sessão = conceito por-usuário da Fase 2; Gateway substitui o
  Supabase do ponto de vista da CLI; permissão = perfil; tudo construído
  aqui.
- **2026-07-27 (revisão do mesmo dia):** decisão revista — em vez de grant
  de senha via Supabase, o mecanismo vira **OAuth2 Authorization Code +
  PKCE**; **toda integração com Supabase é removida** do Gateway (não
  necessária agora); **permissão/perfil não é implementada** nesta etapa
  (nem como placeholder — removi `permission.ts` e o campo do
  `GatewayUser`, em vez de deixar código morto/half-built). Motivo
  declarado pelo dono do produto: simplificar ao máximo pra uso interno,
  aprofundar depois.

## Notas
Próximos passos reais, em ordem: (1) deploy do Gateway em algo acessível
pela internet — hoje só `localhost:8787`; (2) `wrangler deploy` do Edge
Filter apontando `GATEWAY_URL` pra lá; (3) integrar `nio login` com o fluxo
PKCE de verdade (gerar verifier, abrir navegador, subir callback server
local, trocar o code) — hoje o fluxo existe e foi testado via `curl`, mas a
CLI ainda não fala com ele.

**2026-07-27 — pausado.** Decisão do dono do produto: parar aqui por
enquanto (sem afetar o resto da CLI — confirmado: nada fora de
`src/gateway/` importa o módulo, `TOKEN_EXCHANGE_URL` continua no Supabase
como sempre esteve, `src/gateway/**` já estava fora do `tsc`/`dist`
publicado) e retomar a discussão de hospedagem (local-only vs. VPS/Fly/
Railway vs. mover pro Cloudflare também) mais adiante. Código fica como
está — testado, documentado, só não plugado em nada.

**2026-08-23 — superseded por `0003-login-2fa-sms.md`.** Decisão do dono do
produto: o login real da CLI v2 vai por senha (`user_cli`/argon2id) + 2º
fator SMS, não por OAuth2/PKCE self-asserted por email. Este fluxo (T6/T7/T9
nunca fechados, nunca plugado em `nio login`) não vira o mecanismo de auth do
v2. **Código não removido ainda** — nada depende dele hoje, e alguns padrões
(`authorize-store.ts`: Map em memória com TTL e consumo único;
`traceability.ts`: log estruturado em stderr) são candidatos a reuso direto
no Gateway core da 0003. Remoção definitiva (ou reaproveitamento explícito)
fica pra quando a 0003 sair do rascunho.
