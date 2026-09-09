# Arquitetura 2FA por e-mail — substituição do canal SMS (FUTURO / planejado)

> ⚠️ **Feature planejada — não iniciada (planejamento de 2026-09-07).**
> Hoje o 2º fator entrega o OTP por **WhatsApp** (Meta Graph API —
> `WHATSAPP_ENDPOINT_URL`/`WHATSAPP_TOKEN`, `user_cli.phone`, `channel='whatsapp'`;
> ver `ARQUITETURA-GATEWAY.md` — spec 0004 e ADR 0006).
>
> Este documento é o desenho da **troca do canal para e-mail** (OTP entregue por
> SMTP). Motivo: os canais de hoje dependem de provedor pago — o WhatsApp Business
> (Meta Graph, adotado 09 set 2026) e, antes dele, SMS (Twilio/Zenvia/…) ou hardware
> (modem GSM + SIM); **e-mail via SMTP é 100% open-source e sem custo de
> terceiro** — funciona igual com Postfix/Maddy self-hosted, Gmail SMTP,
> Outlook, SES ou MailHog (dev).
>
> **Não confundir com "Login com Google" (OIDC)** — aqui o e-mail é só o *canal
> de entrega* do código de 6 dígitos; o fluxo de OTP nosso (`login_challenges`,
> HMAC, TTL, tentativas, códigos de backup) fica igual.
>
> Supersede: spec 0004 (`login-2fa-sms-otp`) e ADR 0006. Ao implementar, criar
> **ADR 0013 — 2FA por e-mail** e atualizar a nota de 2FA em `ARQUITETURA-GATEWAY.md`.

---

## Visão

1. **OTP de 6 dígitos entregue por e-mail** ao endereço do usuário — não SMS.
2. **Transporte: SMTP genérico** (`nodemailer`, MIT). Uma config (`NIO_SMTP_*`)
   serve todos os backends: self-hosted, Gmail, Outlook, SES, MailHog.
3. O **provedor do destinatário** (gmail / hotmail / outlook / corporativo) é
   **irrelevante** — mandamos um e-mail pra um endereço, ponto. Nada de
   "integração com Google" no caminho principal.
4. **Abstração generalizada**: o port deixa de ser `SmsSender` e vira
   `OtpMessenger`. Re-adicionar SMS ou plugar TOTP no futuro = *adapter novo*,
   nunca outro refactor.
5. **Substitui** o SMS (não coexiste). Base de migração = **0 usuários com
   `auth_2 = true`** hoje → troca sem custo de re-enrollment.

---

## Decisões do dono (2026-09-07)

| # | Decisão |
|---|---------|
| D1 | **(a) e-mail como canal de OTP** — não é "Login com Google"/OIDC, não é Gmail API como fator. |
| D2 | Transporte = **SMTP genérico** (primário). Gmail API OAuth2 = fase 3, só se o Workspace bloquear App Password. |
| D3 | **Substituir** SMS — não manter os dois canais. |
| D4 | Implementar em **100% do fluxo atual** — nada de meio-swap; a superfície inteira (§ "Superfície de refactor") vai junto. |
| D5 | Modo **echo/dev** (já existe pro SMS desde 2026-09-07) carrega pro e-mail: SMTP loopback ou sem config → devolve o código na resposta, CLI mostra. |

---

## Contexto atual (o que já existe e é reaproveitado)

| Componente | Estado | Reaproveita? |
|---|---|---|
| `login_challenges` (OTP nosso, HMAC-SHA256, TTL, `attempts`, `purpose`) | ✅ | **Sim, inteiro** |
| 10 códigos de backup de uso único (caminho alternativo — exigência NIST) | ✅ | **Sim, inteiro** |
| `verifyOtp` / `hashOtp` / `generateOtp` (`src/lib/auth/otp.ts`) | ✅ | Sim (só muda comentário + TTL) |
| Rotas `POST /verify-2fa`, `/security/*` + Kong (`/verify-2fa`, `/security`) | ✅ | **Sim — Kong nem muda** (rotas já genéricas) |
| Throttle `smsAllowed` (M-4, cap por usuário/número) | ✅ | Renomeia → `otpDeliveryAllowed`, mesmos caps |
| `smsMode()` / `devCode` (fix de visibilidade do echo, 2026-09-07) | ✅ | Renomeia → `deliveryMode()` |
| Adapter `src/adapters/sms/whatsapp.ts` (Meta Graph: token + template) | ✅ | Repurpose → adapter HTTP de e-mail (Resend/Postmark/relay) |
| `user_cli.phone` (TEXT nullable) | ✅ | **Substituída** por `email` |
| `channel TEXT CHECK (channel IN ('whatsapp'))` | ✅ | Vira `CHECK (channel IN ('email'))` |
| `OtpSender` / `SmsResult` (`src/core/messaging.ts`) | ✅ | Renomeia → `OtpMessenger` / `DeliveryResult` |

---

## Riscos / reversões a registrar

- **Supersede decisão documentada.** spec 0004 + ADR 0006 (SMS) saem de cena.
  Criar **ADR 0013**; a nota de 2FA em `ARQUITETURA-GATEWAY.md` (reescrita em 09 set
  2026 — WhatsApp) sairá de cena de novo se o e-mail entrar.
- **Nova dependência: `nodemailer`.** A CLI evitou libs de rede até aqui (o SMS
  foi `fetch` POST manual, sem dep). SMTP **não** é trivial (STARTTLS, AUTH
  LOGIN/PLAIN, MIME, folding) → `nodemailer` é a escolha certa, mas é 1 dep nova
  a justificar no PR.
- **E-mail 2FA é mais fraco que TOTP.** Comprometer o inbox = bypass total do 2º
  fator. É comparável a SIM-swap no SMS (o modelo de ameaça não piora), mas o
  ADR 0013 tem que registrar isso como **trade-off aceito** em troca de
  custo-zero + 100% FOSS. Mitigação: códigos de backup continuam sendo a saída;
  recomendar (doc) que o e-mail de 2FA tenha 2FA próprio.
- **`DROP COLUMN phone`** é irreversível sem restore. OK com 0 usuários; se
  algum tiver 2FA quando isto for implementado → **re-enrollment obrigatório**
  (avisar antes).
- **Deliverability.** Sem SPF + DKIM + DMARC no domínio remetente, os códigos
  caem no spam / são rejeitados. Runbook obrigatório (§ "Deliverability").
- **Greylisting / filtro** atrasa e-mail 1–5 min → **TTL do OTP sobe de 5 → 10
  min** (`OTP_TTL_MS`).
- **Reputação do mailbox.** Gmail SMTP = 500 destinatários/dia. Um cap global
  diário protege contra estourar isso e contra mail-bomb distribuído.

---

## PARTE A — Núcleo do swap (Fase 1) — DETALHADA

### A1 — Migração `db/migrations/0009_2fa_email.sql`

```sql
-- 0009 — 2FA por e-mail: substitui o canal SMS (ADR 0013, supersede 0006).
-- Base: 0 usuários com auth_2 = true → sem re-enrollment.

ALTER TABLE user_cli ADD COLUMN email TEXT;
ALTER TABLE user_cli ADD CONSTRAINT user_cli_email_fmt
  CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
ALTER TABLE user_cli DROP COLUMN phone;

ALTER TABLE login_challenges DROP CONSTRAINT login_challenges_channel_check;
ALTER TABLE login_challenges ADD  CONSTRAINT login_challenges_channel_check
  CHECK (channel IN ('email'));

-- purpose ganha 'change_email' já pensando na Fase 2 (barato agora):
ALTER TABLE login_challenges DROP CONSTRAINT login_challenges_purpose_check;
ALTER TABLE login_challenges ADD  CONSTRAINT login_challenges_purpose_check
  CHECK (purpose IN ('login', 'enable_2fa', 'change_email'));
```

- `email` **não** é `UNIQUE` (uma pessoa pode ter 2 contas CLI).
- Guardado sempre `lower(trim(email))` — normalização na camada de app.
- `db/schema.sql` espelha o estado final.
- CI: `db:migrate --baseline` já cobre (schema.sql fresco).

### A2 — Core / port (`src/core/messaging.ts`)

```ts
export interface DeliveryResult {
  status: 'sent' | 'skipped' | 'failed';
  error?: string;
}

export interface OtpMessage {
  subject: string;
  text: string;        // texto puro — SEM link clicável (anti-phishing)
}

export interface OtpMessenger {
  /** Entrega `message` pro endereço `to`. Nunca lança — erro vira DeliveryResult. */
  send(to: string, message: OtpMessage): Promise<DeliveryResult>;
}
```

`src/core/types.ts` e `src/core/repositories.ts`: `channel: 'sms'` → `channel: 'email'`.
`ChallengePurpose` ganha `'change_email'`.

### A3 — Adapter SMTP (`src/adapters/messaging/smtp.ts`) — **novo, primário**

```ts
import nodemailer from 'nodemailer';
import type { OtpMessenger, DeliveryResult, OtpMessage } from '../../core/messaging.js';

interface SmtpEnv {
  host?: string; port?: number; user?: string; pass?: string;
  from?: string; secure?: boolean;
}
function readEnv(): SmtpEnv { /* NIO_SMTP_HOST/PORT/USER/PASS/FROM/SECURE */ }

export function createSmtpMessenger(env: SmtpEnv = readEnv()): OtpMessenger {
  return {
    async send(to, msg): Promise<DeliveryResult> {
      if (!env.host || !env.from) return { status: 'skipped', error: 'NIO_SMTP_* não configurado' };
      // STARTTLS obrigatório p/ host não-loopback; recusa downgrade.
      const transport = nodemailer.createTransport({
        host: env.host, port: env.port ?? 587,
        secure: env.secure ?? false,          // false = STARTTLS na 587
        requireTLS: !isLoopback(env.host),
        auth: env.user ? { user: env.user, pass: env.pass } : undefined,
        connectionTimeout: 10_000, greetingTimeout: 10_000,
      });
      try {
        await transport.sendMail({ from: env.from, to, subject: msg.subject, text: msg.text });
        return { status: 'sent' };
      } catch (err) {
        return { status: 'failed', error: (err as Error).message };
      } finally {
        transport.close();
      }
    },
  };
}
```

**Env:**
```ini
NIO_SMTP_HOST=smtp.gmail.com
NIO_SMTP_PORT=587
NIO_SMTP_USER=nio-2fa@empresa.com
NIO_SMTP_PASS=<app password>
NIO_SMTP_FROM=NIO <nio-2fa@empresa.com>
NIO_SMTP_SECURE=false          # true = 465 (TLS direto) | false = 587 (STARTTLS)
```

### A4 — Adapter HTTP genérico (repurpose)

`src/adapters/sms/http-generic.ts` → `src/adapters/messaging/http-generic.ts`.
Assinatura passa a `send(to, { subject, text })`; template ganha `{subject}`.
Fica como **secundário** — pluga Resend / Postmark / relay self-hosted:
```ini
NIO_EMAIL_ENDPOINT_URL=https://api.resend.com/emails
NIO_EMAIL_AUTH_HEADER=Authorization: Bearer re_xxx
NIO_EMAIL_BODY_TEMPLATE={"from":"{from}","to":"{to}","subject":"{subject}","text":"{text}"}
```
`createOtpMessenger()` decide: `NIO_SMTP_HOST` presente → SMTP; senão `NIO_EMAIL_ENDPOINT_URL` → HTTP; senão `skipped`.

### A5 — `deliveryMode()` (era `smsMode()`)

`src/adapters/messaging/mode.ts` (ou junto do factory):

| Condição | mode | Efeito |
|---|---|---|
| `NIO_SMTP_HOST` em loopback (`127.0.0.1`/`localhost`/`::1`) — ex. MailHog `:1025` | `echo` | devolve `devCode`, CLI mostra o código, **nada é enviado de verdade** (na visão do gateway) |
| sem `NIO_SMTP_*` e sem `NIO_EMAIL_ENDPOINT_URL` | `unconfigured` | `enable-2fa` → 400 "2FA não configurado"; login 1FA segue |
| host real (SMTP ou HTTP) | `smtp` / `http` | envio normal |

`smsProviderHost()` → `deliveryHost()` (host do SMTP/endpoint, pro `status`).

### A6 — Gateway services

**`src/gateway/services/security.ts`**
- `startSecurityChallenge(userId, email, deps)` — `messenger.send(email, { subject, text })`.
  - subject: `NIO — código de verificação`
  - text: `Seu código de verificação NIO é 123456. Expira em 10 minutos. Se não foi você, ignore este e-mail.`
- `SecurityStatus`: `sms:{mode,host}` → `delivery:{mode,host}`.
- `maskPhone` → `maskEmail` (`h•••@gmail.com` — 1º char + domínio).

**`src/gateway/services/login.ts`**
- Caminho `2fa_required`: `messenger.send(user.email, …)`; `phoneHint` → `emailHint`.
- `LoginOutcome` 2fa_required: `smsMode` → `deliveryMode`.

### A7 — Throttle (`src/gateway/throttle.ts`)

- `smsAllowed(userId, phone)` → `otpDeliveryAllowed(userId, email)`.
- Caps **iguais** (3 / 15 min por usuário; 1 / 60 s por endereço). Aqui o abuso é
  **mail-bomb** na vítima, não toll fraud — mesmo cap resolve.
- Consts `SMS_PER_USER` / `SMS_*_WINDOW_MS` → `OTP_*`.
- **Opcional (registrar):** cap global diário `NIO_OTP_DAILY_CAP` (default ~200)
  p/ proteger a reputação/limite do mailbox.

### A8 — Gateway HTTP (`src/gateway/index.ts`)

- `POST /security/enable-2fa` body `{ phone }` → `{ email }` + validação de formato
  (regex simples; a entrega confirma o resto).
- `POST /security/challenge`, `/login` (2fa_required): resposta `smsMode` →
  `deliveryMode`, `phoneHint` → `emailHint`, `devCode` inalterado.
- `auditAuth` — evento `2fa_sent` continua; adicionar `email_delivery_failed` no
  caminho de erro (hoje só loga).

### A9 — CLI

- `src/lib/auth/gateway-client.ts` — tipos: `SmsMode` → `DeliveryMode`,
  `ChallengeStarted.smsMode` → `deliveryMode`; `enable(token, email)`.
- `src/cli/commands/security.ts`:
  - `runEnable` — prompt `"E-mail para receber os códigos"` + valida formato.
  - `noteSmsMode` → `noteDeliveryMode` (box de aviso do echo — já existe).
  - `runStatus` — linha `Entrega: SMTP smtp.gmail.com` / `echo (dev)` / `não configurado`.
  - `maskPhone` local → `maskEmail`.
- `src/cli/commands/auth.ts` — `resolveSecondFactor`: texto
  `"código enviado por e-mail para h•••@gmail.com"`.

### A10 — `src/lib/auth/otp.ts`

- `OTP_TTL_MS` (em `login.ts`): `5 * 60_000` → `10 * 60_000`.
- Comentário do módulo: "SMS" → "e-mail".

### A11 — Config + deps

- `package.json`: `+ nodemailer ^6` , `+ @types/nodemailer` (dev). `bun add`.
- `.env.example`: bloco `NIO_SMTP_*` + nota do modo echo (MailHog). **Remove** o
  bloco `SMS_*`.
- `docker/docker-compose*.yml`: passa `NIO_SMTP_*` pro container do gateway.
- `~/.nio/config.env` (time): o mailbox remetente — **nunca** no `.env` do repo.

### A — Arquivos (superfície completa da Fase 1)

**Renomeados:**
```
src/adapters/sms/                → src/adapters/messaging/
src/adapters/sms/http-generic.ts → src/adapters/messaging/http-generic.ts
```
**Novos:**
```
src/adapters/messaging/smtp.ts
src/adapters/messaging/smtp.test.ts
src/adapters/messaging/index.ts          (createOtpMessenger + deliveryMode + deliveryHost)
db/migrations/0009_2fa_email.sql
docs/adr/0013-2fa-email.md
```
**Modificados:**
```
src/core/messaging.ts        src/core/types.ts        src/core/repositories.ts
src/adapters/pg/user-repository.ts        src/adapters/pg/login-challenge-repository.ts
src/gateway/index.ts         src/gateway/throttle.ts
src/gateway/services/login.ts             src/gateway/services/security.ts
src/lib/auth/otp.ts          src/lib/auth/gateway-client.ts
src/cli/commands/security.ts              src/cli/commands/auth.ts
db/schema.sql                .env.example               package.json
docker/docker-compose.yml    docker/docker-compose.deploy.yml
docs/arch/ARQUITETURA-GATEWAY.md          (nota de 2FA)
```
**Testes:**
```
src/adapters/messaging/smtp.test.ts             (novo — echo/skipped/failed/TLS)
src/adapters/messaging/http-generic.test.ts     (adapta — {to,subject,text})
src/gateway/services/security.test.ts           (email em vez de phone; delivery.mode)
src/gateway/services/login.test.ts              (2fa_required com deliveryMode)
src/gateway/services/login.integration.test.ts  (fio DB+OTP com e-mail; MailHog opcional)
```

### A — Verificação

```bash
# unit
bun test src/adapters/messaging src/gateway/services/security.test.ts \
         src/gateway/services/login.test.ts

# integração (Postgres real + MailHog local)
docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog
NIO_SMTP_HOST=127.0.0.1 NIO_SMTP_PORT=1025 NIO_SMTP_FROM='NIO <nio@local>' \
  bun test src/gateway/services/login.integration.test.ts

# smoke ponta a ponta (2 terminais + MailHog)
#  T-A: NIO_SMTP_HOST=127.0.0.1 NIO_SMTP_PORT=1025 ... bun run dev:gateway
#  T-B: bun run dev:cli -- security enable-2fa   → digita e-mail
#       → modo echo mostra o código na CLL; e-mail também na UI do MailHog (:8025)
#       cola o código → 2FA ativado
#  T-B: bun run dev:cli -- login (com 2FA)       → código por e-mail
#  T-B: bun run dev:cli -- security status       → "Entrega: echo (dev)"
```

---

## PARTE B — E-mail no cadastro + troca de e-mail (Fase 2) — detalhada

### B1 — Capturar e-mail no `nio register`
- `register()` service + `POST /register` body ganham `email` (obrigatório?
  **recomendado obrigatório** — sem ele o `enable-2fa` não tem pra onde mandar).
- CLI `runRegister` — prompt de e-mail + validação + confirmação (digitar 2×).
- `user_cli.email` já existe (migração 0009).
- Enumeração: `register` não vaza (é sobre a própria conta). Sem mudança no timing.

### B2 — `nio security change-email`
- Novo fluxo: OTP pro **e-mail atual** → confirma → OTP pro **e-mail novo** →
  confirma → grava. (`purpose = 'change_email'`, já no CHECK da 0009.)
- Gateway: `POST /security/change-email` (Bearer). Revoga sessões? **Não**
  necessariamente — trocar e-mail ≠ trocar senha. Mas audita (`email_changed`).
- CLI: `nio security change-email`.

### B3 — `enable-2fa` usa o e-mail do cadastro
- Se o e-mail já está no `user_cli` (via register), o `enable-2fa` **não pergunta**
  — usa o cadastrado, só confirma ("enviar código para h•••@gmail.com? [S/n]").
- Fallback: se não tiver e-mail, pergunta e grava.

---

## PARTE C — Extensões (Fase 3–4) — ESBOÇO

| # | Item | Quando |
|---|------|--------|
| **C1** | Adapter **Gmail API OAuth2** (`src/adapters/messaging/gmail-api.ts`) — `gmail.users.messages.send` com refresh token. Só se o Google Workspace do time **desabilitar App Password** (força OAuth). Dep `googleapis`. | se/quando bloquear SMTP |
| **C2** | Adapter **Microsoft Graph** (envio via conta M365) — mesmo motivo do C1 pra Outlook corporativo. | idem |
| **C3** | `channel` **plugável de verdade** — `CHECK (channel IN ('email','totp','sms'))` + registro de messengers por canal. Re-adiciona **TOTP (RFC 6238)** como 2º tipo de fator (QR ASCII no `enable-2fa`, sem entrega). | quando quiser TOTP |
| **C4** | E-mail de 2FA **≠** e-mail de identidade (campo separado `otp_email`) — reduz o "inbox único = ponto de falha". | opcional |
| **C5** | **Relay self-hosted documentado** — `scripts/mail-relay.ts` (recebe `{to,subject,text}` → chama provedor X) pra provedores que precisam de assinatura/OAuth sem meter dep no gateway. | se precisar de SES/SNS |

---

## Ordem de execução

```
FASE 1 (Parte A) — 1 PR
  A1 migração 0009 + schema.sql
  A2 core/messaging + types + repositories
  A3 adapter smtp.ts  +  A4 http-generic repurpose  +  A5 deliveryMode
  A6 services (login, security)  +  A7 throttle  +  A8 gateway/index
  A9 CLI (gateway-client, security, auth)  +  A10 otp TTL  +  A11 env/deps
  testes (unit + integração MailHog) → verde
  ADR 0013 + nota em ARQUITETURA-GATEWAY.md
  smoke ponta a ponta → commit

FASE 2 (Parte B) — 1 PR
  B1 e-mail no register  →  B2 change-email  →  B3 enable-2fa usa o cadastrado

FASE 3+ (Parte C) — sob demanda, 1 PR por item
```

---

## Superfície de refactor — renomeações (grep-and-replace guiado)

| De | Para | Onde |
|---|---|---|
| `src/adapters/sms/` | `src/adapters/messaging/` | dir |
| `OtpSender` | `OtpMessenger` | core + adapters + services + tests |
| `SmsResult` | `DeliveryResult` | idem |
| `createWhatsAppSender` | `createHttpOtpMessenger` | adapter + callers |
| `smsMode` / `smsProviderHost` | `deliveryMode` / `deliveryHost` | adapter + services + CLI |
| `smsAllowed` | `otpDeliveryAllowed` | throttle + callers |
| `SMS_PER_USER` / `SMS_*_WINDOW_MS` | `OTP_PER_USER` / `OTP_*_WINDOW_MS` | throttle + tests |
| `maskPhone` | `maskEmail` | login.ts + CLI (lógica muda: 1º char + domínio) |
| `noteSmsMode` | `noteDeliveryMode` | CLI security.ts |
| `phone` / `phoneHint` | `email` / `emailHint` | schema, types, repos, services, gateway, CLI |
| `channel: 'whatsapp'` | `channel: 'email'` | schema CHECK, types, repos |
| env `WHATSAPP_ENDPOINT_URL` / `WHATSAPP_TOKEN` | `NIO_SMTP_*` / `NIO_EMAIL_*` | .env.example, config.env, compose |

---

## Fora de escopo (registrar explicitamente)

- **"Login com Google" / OIDC** como 2º fator — design totalmente diferente
  (provar posse de conta Google via OAuth, sem código digitado). Não é isto.
- **Magic-link** (e-mail com link clicável que autentica) — **decisão: só
  código**. Link treina o usuário a clicar em e-mail "da NIO" → vetor de phishing.
- **Multi-canal simultâneo escolhível** (usuário escolhe e-mail | SMS | TOTP no
  login) — Fase 4+ (Parte C3), não agora.
- **Provedor transacional pago como default** (SES / SendGrid / Postmark) —
  documentado como opção (§ abaixo), nunca o default do `.env.example`.
- **Verificação de e-mail no cadastro além do OTP de 2FA** (double opt-in) —
  o `enable-2fa` já prova posse do e-mail; um double opt-in separado no register
  é enhancement, não requisito.

---

## Opções de envio — 100% open-source

| Solução | FOSS | Custo | Nota |
|---|:---:|---|---|
| **Maddy** (Go, binário único) | ✅ MIT | domínio + VPS | DKIM embutido — **recomendado p/ self-host** |
| **docker-mailserver** / Mailcow | ✅ | domínio + host | completo, mais pesado |
| **Gmail SMTP + App Password** | — (SMTP é padrão) | grátis, 500/dia | 5 min de setup; exige 2FA na conta Google; Workspace pode bloquear |
| **Outlook / O365 SMTP** | — | — | `smtp.office365.com:587`; M365 moderno pode exigir OAuth2 (→ Parte C2) |
| **Amazon SES (SMTP)** | — | ~US$0,10/1k | mais confiável; não-FOSS mas SMTP padrão |
| **MailHog / Maildev** (dev) | ✅ | grátis | Docker; pega todo e-mail; UI `:8025`; é o **modo echo** |

O adapter SMTP é **o mesmo** pra todos — só muda `NIO_SMTP_HOST`.

---

## Segurança — mapa de riscos

| Risco | Severidade | Mitigação |
|---|:---:|---|
| Inbox comprometido → bypass total do 2º fator | Média | Comparável a SIM-swap. Códigos de backup = saída. Recomendar 2FA no e-mail. Registrar como trade-off no ADR 0013. |
| E-mail de OTP + recuperação de senha no mesmo inbox = ponto único | Média | Documentar. Parte C4: `otp_email` separado. |
| Mail-bomb da vítima via `enable-2fa` / `login` repetido | Média | Cap por endereço (1/60s) + por usuário (3/15min) + opcional cap global diário. |
| Código no spam / rejeitado | Alta (usabilidade) | SPF + DKIM + DMARC obrigatórios (runbook). TTL 10 min. Texto plano, sem link. |
| Credencial do mailbox remetente = novo segredo | Média | `~/.nio/config.env` (0600), **nunca** no `.env` do repo. Tratamento de keyring como `JWT_SECRET`. |
| SMTP em texto claro (downgrade) | Alta | `smtp.ts` exige STARTTLS/TLS p/ host não-loopback; `requireTLS: true`. |
| Enumeração de e-mail | Baixa | `enable-2fa` é sobre a própria conta. `login` 2FA só mostra hint mascarado. Sem mudança. |
| Falha de entrega tranca o login (2FA obrigatório) | Média | Códigos de backup. UX: no `enable-2fa`, **exigir** que o usuário guarde os backup codes antes de finalizar. |
| Conteúdo do e-mail treina phishing | Baixa | Só código, sem link/botão. Assunto neutro. Frase "se não foi você, ignore". |

---

## Deliverability — runbook (domínio remetente)

1. **SPF** — TXT em `empresa.com`: `v=spf1 include:_spf.google.com ~all`
   (ou o range do seu SMTP self-hosted / SES).
2. **DKIM** — chave gerada pelo provedor/Maddy; TXT em `<selector>._domainkey.empresa.com`.
3. **DMARC** — TXT em `_dmarc.empresa.com`: `v=DMARC1; p=quarantine; rua=mailto:dmarc@empresa.com`.
4. **PTR / rDNS** (self-host) — o IP de saída resolve pro hostname do MX.
5. **Teste** — enviar pra `check-auth@verifier.port25.com` ou usar mail-tester.com;
   mirar score ≥ 9/10 antes de subir pra prod.
6. **Warm-up** (self-host novo) — volume baixo nos primeiros dias.

---

## Ligações

- `docs/arch/ARQUITETURA-GATEWAY.md` — 2º fator (nota reescrita em 09 set 2026 — WhatsApp)
- `docs/security/README.md` — status da auditoria (o 2FA por e-mail entra como evolução, não achado)
- ADR 0013 (a criar) — a decisão formal
- `docs/arch/ARQUITETURA-CLIENTES-MULTI-FUTURO.md` — mesmo formato deste doc (feature futura mapeada)
