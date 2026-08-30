---
id: "0004"
title: Login com 2º fator — SMS OTP direto no gateway
area: auth
status: implemented
created: 2026-08-29
supersedes: "0003"
---

# Login com 2º fator — SMS OTP direto no gateway

## Problema

O `nio login` (v2) autentica com usuário/senha num único fator. Falta um 2º fator.
As specs anteriores desenharam SMS via Twilio Verify (`0003`) e depois TOTP
(`diagrama/ARCHITETURA-2FA-TOTP.md`) — ambas pausadas. Pra fechar a v1, o dono
quer o 2º fator como **mensagem de confirmação** (SMS), sem Twilio e sem broker.

Decisão formal: [ADR 0006](../../adr/0006-2fa-sms-otp.md).

## Solução

Fluxo (`auth_2 = true`):

```
nio login  ──POST /login {name,password}──►  gateway
                                             ├─ verifyCredentials (argon2id) ──✗──► 401
                                             ├─ auth_2 = false ──► issueSession ──► { step:'done', ...JWT }
                                             └─ auth_2 = true:
                                                  otp = 6 dígitos
                                                  login_challenges.create(code_hash=HMAC(otp), TTL 5min)
                                                  SmsSender.send(phone, "NIO: seu código é ...")
                                                    ├─ skipped ──► 503 "2FA não configurado no servidor"
                                                    ├─ failed  ──► 503 "falha ao enviar o SMS"
                                                    └─ sent    ──► 200 { step:'2fa_required', challengeId, phoneHint }
CLI pede o código ──POST /verify-2fa {challengeId,code,type}──► gateway
                                             challengeUsable? (não consumido, não expirado)
                                             type=otp:   verifyOtp(code, code_hash)
                                                 ✓ ──► consume + issueSession ──► 200 { step:'done', ...JWT }
                                                 ✗ ──► attempts++ ; >=3 ──► 429 {reason:'attempts_exhausted', requiresBackupCode}
                                                                    senão ──► 401 {reason:'invalid', remaining}
                                             type=backup: verifyBackupCode(code, user.backup_codes)
                                                 ✓ ──► markUsed + consume + issueSession ──► 200 { ...JWT, backupCodesRemaining }
```

A CLI (`resolveSecondFactor` em `src/cli/commands/auth.ts`): pede o código SMS até
3×; ao receber `requiresBackupCode`, troca pro prompt de código de backup.

### Gerência (`nio security …`, gateway `/security/*`, exige o Bearer da sessão)

| Comando | Rotas | Efeito |
|---|---|---|
| `enable-2fa` | `POST /security/enable-2fa {phone}` → SMS → `POST /security/confirm-2fa {challengeId,code,phone}` | `auth_2=true`, grava `phone`, gera 10 códigos de backup (mostrados 1×) |
| `disable-2fa` | `POST /security/challenge` (SMS pro nº registrado) → `POST /security/disable-2fa {challengeId,code,type}` | `auth_2=false`, limpa `phone`/`backup_codes` |
| `regenerate-backup-codes` | `POST /security/challenge` → `POST /security/regenerate-backup-codes {challengeId,code,type}` | 10 códigos novos, antigos invalidados |
| `status` | `GET /security/status` | `{ enabled, phoneHint, backupCodesRemaining }` |

## Modelo de dados (migration `0004_login_2fa.sql`)

- `user_cli += phone TEXT` (E.164; `NULL` = 2FA off), `backup_codes TEXT` (10
  hashes argon2id juntos por `|`; usado = `[USED]`).
- **`login_challenges`** — `id UUID`, `user_id FK ON DELETE CASCADE`,
  `purpose CHECK('login'|'enable_2fa')`, `code_hash TEXT` (HMAC-SHA256(código,
  `JWT_SECRET`)), `channel CHECK('sms')`, `attempts INT`, `expires_at`,
  `consumed_at`, `created_at`. Índices por `user_id` e `expires_at`.
- `create` apaga (em transação) os desafios ativos anteriores do usuário e os
  expirados — 1 desafio ativo por vez, limpeza sem cron.

## Config (env, **sem prefixo `NIO_`** — regra do `JWT_SECRET`)

```
SMS_ENDPOINT_URL    https://api.provedor.com/v2/sms
SMS_AUTH_HEADER     "X-API-TOKEN: abc"   (linha "Nome: valor")
SMS_BODY_TEMPLATE   {"to":"{to}","message":"{text}"}   (JSON com {to}/{text}/{from})
SMS_FROM            (opcional, se o template usar {from})
```

Faltou `SMS_ENDPOINT_URL` ou `SMS_BODY_TEMPLATE` → `SmsSender` devolve `skipped`
→ o login com 2FA responde 503 "2FA não configurado no servidor" (o login de 1
fator segue funcionando).

## Constraints herdadas da spec 0003 (seguem valendo)

- **Nunca logar/persistir o OTP em texto puro** — `code_hash` é HMAC; o
  `logAuthEvent` só grava metadados. (ANPD Resolução CD/ANPD nº 15/2024.)
- **SMS não pode trancar o usuário** — códigos de backup são a alternativa.
  (NIST SP 800-63B Rev. 4, SMS = Restricted Authenticator.)
- **Trilha auditável de tentativas** — `logAuthEvent(ctx, result, {name,userId,reason})`
  em stderr, `event: 'auth_attempt'`, desde o 1º commit.
- **Código é uso único** — `consumed_at`.
- `stdout` reservado pro JSON-RPC do MCP quando aplicável; logs em stderr.

## O que ficou fora (v1)

- Tabela `login_attempts` (auditoria queryável) — stderr basta por ora.
- Rotação de `JWT_SECRET` invalida desafios em andamento — aceitável (TTL 5 min).
- Multi-canal (e-mail, Telegram) — o port `SmsSender` já isola; adicionar é um
  adapter novo.
- 2º fator obrigatório por política — hoje é opt-in por conta.

## Reuso

`UserRepository.verifyCredentials` (0001), `AuthSessionRepository` (0002),
`authenticate()` middleware (0002), `logRequest`/edge-filter (0002/0003),
`lib/auth/password` (argon2id), `lib/auth/gateway-token` (`X-Nio-Gateway-Token`), Kong
rate-limiting (`kong/kong.yml`).
