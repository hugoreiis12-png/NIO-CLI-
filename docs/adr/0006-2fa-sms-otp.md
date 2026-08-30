---
id: "0006"
title: 2º fator do login — SMS OTP direto no gateway (sem Twilio, sem broker)
status: accepted
created: 2026-08-29
---

# 2º fator do login — SMS OTP direto no gateway (sem Twilio, sem broker)

## Contexto

A auth v2 é 1 fator (usuário/senha → JWT). `user_cli.auth_2` existe mas nada a
usa. O 2º fator já foi desenhado 2× e pausado: spec `0003` (SMS via **Twilio
Verify**) e `diagrama/ARCHITETURA-2FA-TOTP.md` (**TOTP + backup codes**). Ambos
parados — "abandonando Twilio, avaliando TOTP self-hosted" (PROGRESSO, 25 ago).

Pra fechar a **v1 da CLI**, o dono do produto quer o 2º fator por **mensagem de
confirmação** — o que descarta o TOTP puro (não envia nada). Retoma o SMS, mas
sem Twilio e com arquitetura própria.

## Decisão

**2º fator = OTP de 6 dígitos por SMS, gerado e verificado no `nio-gateway`.**

- **Mensageria = serviço direto no gateway** (sem message broker, sem fila). O
  `POST /login` verifica a senha, gera o OTP, **envia o SMS em processo** e
  responde `2fa_required`; a CLI pede o código; `POST /verify-2fa` valida e só
  então emite o JWT.
- **Canal = adapter de SMS HTTP genérico** — `SMS_ENDPOINT_URL` + `SMS_AUTH_HEADER`
  + `SMS_BODY_TEMPLATE` (JSON com `{to}`/`{text}`). Pluga qualquer provedor por
  env, zero código por provedor. Env sem prefixo `NIO_` (regra do `JWT_SECRET` —
  segredo da equipe, mesmo valor em toda máquina que roda o gateway).
- **Estado do OTP é nosso** (não há Twilio pra guardá-lo): tabela
  `login_challenges` — `code_hash` = HMAC-SHA256(código, `JWT_SECRET`) (**nunca o
  código puro**, constraint ANPD da spec 0003), TTL 5 min, 3 tentativas, uso
  único (`consumed_at`).
- **Fallback = 10 códigos de backup** de uso único (hash argon2id, reusa
  `lib/password`), mostrados 1× no `enable-2fa`. Satisfazem a exigência NIST SP
  800-63B / spec 0003 de o SMS **não trancar** o usuário fora. Após 3 OTP errados
  no login, a CLI troca pro prompt de código de backup.
- **`auth_2` é opt-in** — `nio security enable-2fa|disable-2fa|status|
  regenerate-backup-codes` (gateway `/security/*`, exigem o Bearer da sessão).
- **Trilha auditável** = log estruturado em stderr do gateway (`logAuthEvent`,
  `event: 'auth_attempt'`) — nunca a senha ou o OTP. Uma tabela `login_attempts`
  fica de follow-up.

## Consequências

**Positivas:**
- Reusa tudo do repo: serviço do gateway (`login.ts`), tabela estilo
  `dependency_events`, port `SmsSender` com contrato "nunca lança" (como
  `ToolchainGateway`/`DockerGateway`), hash argon2id de `lib/password`, comando
  com subgrupo (`docker.ts`/`deps.ts`), `env()` sem prefixo (`JWT_SECRET`).
- Sem conta Twilio (custo ~US$0.11/login evitado); sem broker pra manter.
- Provedor de SMS trocável por env, sem release.

**Negativas / trade-offs:**
- **SMS segue sendo Restricted Authenticator (NIST)** — SIM swap é real. Mitigado
  pelos códigos de backup e por avisar o usuário; não eliminado.
- Sem fila: se o provedor de SMS está lento/fora, o `/login` responde 503 na hora
  (sem retry). Aceitável — o login não fica "meio feito".
- `code_hash` com HMAC (não argon2) — ok pra um código de 6 dígitos de vida curta
  e rate-limitado (Kong: 10/min em `/verify-2fa`), não pra uma senha.
- O `JWT_SECRET` vira também a chave do HMAC do OTP — rotacioná-lo invalida os
  desafios em andamento (aceitável, TTL de 5 min).

## Alternativas consideradas

- **Message broker (NATS/RabbitMQ) + worker** — descartado pelo dono: mais infra
  pra manter do que o fluxo de 2FA de uma CLI justifica.
- **Fila no Postgres + loop de worker** (estilo `DependencyWatcher`) — descartado:
  o `nio-gateway` já é o processo certo pra mandar o SMS na hora do `/login`.
- **TOTP + backup codes** (`ARCHITETURA-2FA-TOTP.md`) — descartado: o dono quer
  uma **mensagem de confirmação**, TOTP não envia nada. O sketch de backup codes
  desse doc foi reaproveitado.
- **Twilio Verify** (spec 0003) — descartado: custo + dependência externa; o
  adapter HTTP genérico cobre qualquer provedor.

## Referências

- `docs/specs/auth/0004-login-2fa-sms-otp.md` — a spec detalhada.
- `docs/specs/auth/0003-login-2fa-sms.md` — `superseded` por esta; as constraints
  NIST/ANPD dela seguem valendo e são citadas na 0004.
- `db/migrations/0004_login_2fa.sql`, `src/gateway/services/{login,security}.ts`,
  `src/core/messaging.ts`, `src/adapters/sms/http-generic.ts`, `src/lib/{otp,backup-codes}.ts`,
  `src/cli/commands/security.ts`.
- `docs/v2/ARQUITETURA-GATEWAY.md` (seção 2FA).
