# Kong + NIO Gateway — Guia de Uso

> Documentação detalhada de como consumir os serviços de autenticação do NIO
> via Kong API Gateway e NIO Gateway, tanto de dentro da rede (Docker network
> `nio-net`) quanto de aplicações externas.

---

## Sumário

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Tabela de Rotas](#2-tabela-de-rotas)
3. [Autenticação com Gateway Token](#3-autenticação-com-gateway-token)
4. [Rate Limiting](#4-rate-limiting)
5. [Referência dos Endpoints](#5-referência-dos-endpoints)
6. [Variáveis de Ambiente](#6-variáveis-de-ambiente)
7. [Deploy via Portainer](#7-deploy-via-portainer)
8. [Integração com Aplicação Externa](#8-integração-com-aplicação-externa)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Visão Geral da Arquitetura

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Docker networks                                 │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐   │
│  │   nio-infra  │    │    nio-net   │    │  nio-net (externa)   │   │
│  │              │    │              │    │                      │   │
│  │ ┌──────────┐ │    │ ┌──────────┐ │    │  ┌────────────────┐ │   │
│  │ │   Kong   │─┼────┼─│ Gateway  │ │    │  │ Aplicação ext. │─┼───┤
│  │ │  :8000   │ │    │ │  :3000   │ │    │  │   (docker)     │ │   │
│  │ │  :8443   │ │    │ └──────────┘ │    │  └────────────────┘ │   │
│  │ └──────────┘ │    │ ┌──────────┐ │    └──────────────────────┘   │
│  │              │    │ │ Headroom │ │                                │
│  │ ┌──────────┐ │    │ │  :8787   │ │                                │
│  │ │  MCP GW  │ │    │ └──────────┘ │                                │
│  │ │ :8811    │ │    └──────────────┘                                │
│  │ └──────────┘ │                                                     │
│  └──────────────┘                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Fluxo de Requisição

| Origem | Caminho | Descrição |
|--------|---------|-----------|
| Docker (em `nio-net`) | App → Kong `:8000` → Gateway `:3000` | Caminho completo via API Gateway |
| Docker (em `nio-net`) | App → Gateway `:3000` | Acesso direto ao gateway (loopback interno) |
| Docker (em `nio-net`) | App → Headroom `:8787` | Acesso direto ao proxy AI |
| Docker (externa) | App → Kong `:8000` → Gateway `:3000` | Caminho recomendado para apps externos |

### Serviços na Stack Portainer (ID 106)

| Serviço | Container | Porta(s) | Visível na LAN |
|---------|-----------|----------|-----------------|
| Kong API Gateway | `nio-kong` | `8000` (HTTP), `8443` (HTTPS), `8001` (admin) | ✅ Sim |
| NIO Gateway | `nio-gateway` | `3000` (loopback only) | ❌ Não |
| Headroom Proxy | `nio-headroom` | `8787` | ✅ Sim |
| MCP Gateway | `nio-mcp-gateway` | `8811` (127.0.0.1) | ❌ Não |

---

## 2. Tabela de Rotas

Todas as rotas estão declaradas em `docker/kong.yml` (DB-less mode) e roteiam
para o serviço `nio-gateway` (HTTP → `http://nio-gateway:3000`).

### Autenticação

| Método | Rota Kong | Rota Gateway | Rate Limit | Requer Token | Descrição |
|--------|-----------|-------------|------------|--------------|-----------|
| `POST` | `/register` | `/register` | 5/min/IP | ✅ | Cadastro de novo usuário |
| `POST` | `/login` | `/login` | 20/min/IP | ✅ | Login (1º fator + OTP se 2FA habilitado) |
| `POST` | `/logout` | `/logout` | — | ✅ Bearer | Encerra sessão atual |
| `POST` | `/verify-2fa` | `/verify-2fa` | 10/min/IP | ✅ | Valida código OTP/código de backup |

### Segurança

| Método | Rota Kong | Rota Gateway | Rate Limit | Requer Token | Descrição |
|--------|-----------|-------------|------------|--------------|-----------|
| `POST` | `/security/start` | `/security/start` | 10/min/user | ✅ Bearer | Inicia desafio 2FA (envia OTP por WhatsApp) |
| `POST` | `/security/confirm` | `/security/confirm` | — | ✅ Bearer | Confirma ativação/desativação 2FA |
| `POST` | `/security/password` | `/security/password` | — | ✅ Bearer | Troca senha (requer senha atual) |
| `GET`  | `/security/status` | `/security/status` | — | ✅ Bearer | Status do 2FA, IPs recentes, falhas recentes |

### Health Check

| Método | Rota Kong | Rota Gateway | Rate Limit | Requer Token | Descrição |
|--------|-----------|-------------|------------|--------------|-----------|
| `GET` | `/health` | `/health` | — | ❌ | Verificação de saúde do gateway |

---

## 3. Autenticação com Gateway Token

O NIO Gateway implementa um mecanismo de "gateway token" que prova que a
requisição está vindo de uma instalação local autorizada. Este token é
**obrigatório** em todas as rotas exceto `/health`.

### Como Funciona

1. Na primeira inicialização, o gateway gera um token aleatório de 32 bytes
   (64 caracteres hex) e o salva em `~/.nio/gateway.token` (permissão `chmod 600`)
2. Todas as rotas HTTP exigem o header `x-nio-gateway-token` com este valor
3. Requisições sem o token recebem `403 Forbidden`
4. **A partir do v0.5.0:** o token também pode ser fornecido via variável de
   ambiente `NIO_GATEWAY_TOKEN` (sobrepõe o arquivo)

### Validação do Token

```typescript
// src/lib/auth/gateway-token.ts
export function tokensMatch(received: string | string[] | undefined): boolean {
  if (!received) return false;
  const candidates = Array.isArray(received) ? received : [received];
  return candidates.some((c) => timingSafeEqual(c, getGatewayToken()));
}

export function extractGatewayToken(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  return (headers['x-gateway-token'] ?? headers['x-nio-gateway-token']) as string | undefined;
}
```

**Observação:** o código aceita tanto `x-gateway-token` quanto `x-nio-gateway-token`.
Prefira sempre `x-nio-gateway-token` (mais explícito).

### Formato do Header

```
x-nio-gateway-token: f6df401be8ac6f19149f6d7779845d299a3b804648b0896752f76e2d90eb23cc
```

### Token via Variável de Ambiente (v0.5.0+)

No `docker-compose.deploy.yml`, a variável `NIO_GATEWAY_TOKEN` é passada ao
container `nio-gateway`. Quando presente, tem prioridade sobre o arquivo:

```typescript
// src/lib/auth/gateway-token.ts:21-22
const envToken = process.env.NIO_GATEWAY_TOKEN?.trim();
if (envToken && tokensMatch(envToken)) {
  return true;
}
```

---

## 4. Rate Limiting

O rate limiting é aplicado **pela Kong** (plugins `rate-limiting`) e
**adicionalmente pelo gateway** (throttle interno).

### Kong Rate Limits (por IP)

| Rota | Limite | Janela | Plugin Kong |
|------|--------|--------|-------------|
| `/register` | 5 req | 60s | `rate-limiting` |
| `/login` | 20 req | 60s | `rate-limiting` |
| `/verify-2fa` | 10 req | 60s | `rate-limiting` |
| `/security/start` | 10 req | 60s | `rate-limiting` |
| `/security/*` | 10 req | 60s | `rate-limiting` |
| `/logout` | — | — | Sem limite |
| `/health` | — | — | Sem limite |

### Gateway Throttle Interno

O gateway implementa throttle adicional via `src/gateway/throttle.js`:

- **OTP por usuário/número:** cap de envios por combinação userId+phone
  (proteção contra toll fraud — rodar `M-4`)
- **OTP por desafio:** máx. 3 tentativas de OTP por challenge (`OTP_MAX_ATTEMPTS`).
  Após 3 tentativas, cai para código de backup
- **Máx. tentativas por challenge:** `CHALLENGE_MAX_ATTEMPTS` = 6 (OTP + backup
  somados no mesmo contador)

### Headers de Resposta

A Kong retorna headers informativos em cada resposta:

```
RateLimit-Limit: 20
RateLimit-Remaining: 18
RateLimit-Reset: 1693847460
```

---

## 5. Referência dos Endpoints

### 5.1 `POST /register`

Cadastra um novo usuário no sistema.

**Headers:**
```
Content-Type: application/json
x-nio-gateway-token: <token>
```

**Body:**
```json
{
  "name": "meu-usuario",
  "password": "SenhaSegura123!"
}
```

**Validações:**
- `name`: 1–64 caracteres, trimmed
- `password`: mínimo `MIN_PASSWORD_LENGTH` caracteres
- `password` verificado contra breaches de dados (HaveIBeenPwned, SP-7)
- Nome único — timing-attack decoy hash se nome já existe (TP-3)

**Respostas:**
| Status | Body | Descrição |
|--------|------|-----------|
| `201` | `{ "userId": 1, "name": "meu-usuario" }` | Sucesso |
| `400` | `{ "error": "invalid_name" \| "weak_password" \| "breached_password" }` | Validação falhou |
| `409` | `{ "error": "name_taken" }` | Nome já existe |
| `403` | `{ "error": "gateway token required" }` | Token ausente |

### 5.2 `POST /login`

Autentica o usuário. Retorna JWT direto se 2FA desabilitado, ou `challengeId`
se 2FA estiver ativo.

**Headers:**
```
Content-Type: application/json
x-nio-gateway-token: <token>
```

**Body:**
```json
{
  "name": "meu-usuario",
  "password": "SenhaSegura123!"
}
```

**Respostas (2FA desabilitado):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "userId": 1,
  "name": "meu-usuario",
  "sessionId": "abc123...",
  "expiresAt": "2025-09-10T12:00:00.000Z"
}
```

**Respostas (2FA habilitado):**
```json
{
  "step": "2fa_required",
  "challengeId": "def456...",
  "phoneHint": "+55•••••••8888",
  "smsMode": "provider",
  "devCode": "123456"  // somente em modo echo (dev)
}
```

**Outros status:**
| Status | Body | Descrição |
|--------|------|-----------|
| `400` | `{ "error": "bad_credentials" }` | Nome/senha incorretos |
| `500` | `{ "error": "muitos códigos solicitados..." }` | Limite de envio de OTP atingido |
| `500` | `{ "error": "2FA não configurado no servidor (WHATSAPP_*)." }` | `WHATSAPP_*` não definido |

### 5.3 `POST /verify-2fa`

Valida o código OTP ou de backup para completar o login com 2FA.

**Headers:**
```
Content-Type: application/json
x-nio-gateway-token: <token>
```

**Body:**
```json
{
  "challengeId": "def456...",
  "code": "123456",
  "type": "otp"
}
```

`type`: `"otp"` para código OTP, `"backup"` para código de backup.

**Respostas:**
| Status | Body | Descrição |
|--------|------|-----------|
| `200` | `{ "token": "...", "userId": 1, ... }` | Sucesso — retorna JWT |
| `400` | `{ "error": "not_found" \| "expired" \| "consumed" }` | Desafio inválido |
| `400` | `{ "error": "invalid" }` | Código incorreto |
| `400` | `{ "error": "attempts_exhausted" }` | Tentativas esgotadas |

### 5.4 `POST /logout`

Encerra a sessão atual (revoga a auth_session). Idempotente.

**Headers:**
```
Authorization: Bearer <jwt>
```

**Resposta:**
```json
{ "ok": true }
```

### 5.5 `POST /security/start`

Inicia um desafio 2FA — envia OTP por WhatsApp para o número registrado.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <jwt>
x-nio-gateway-token: <token>
```

**Body:**
```json
{
  "phone": "+5511999998888"
}
```

**Validações:**
- Número em formato E.164 (`+` + 8–15 dígitos)
- Limite de envio de OTP por userId+phone

**Respostas:**
| Status | Body | Descrição |
|--------|------|-----------|
| `200` | `{ "challengeId": "...", "smsMode": "provider" }` | WhatsApp enviado |
| `400` | `{ "error": "número inválido..." }` | Formato E.164 inválido |
| `500` | `{ "error": "muitos códigos solicitados..." }` | Limite de envio de OTP |

### 5.6 `POST /security/confirm`

Confirma a ativação ou desativação do 2FA com código de confirmação.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <jwt>
x-nio-gateway-token: <token>
```

**Body (ativação):**
```json
{
  "challengeId": "...",
  "code": "123456",
  "phone": "+5511999998888",
  "action": "enable"
}
```

**Body (desativação):**
```json
{
  "challengeId": "...",
  "code": "123456",
  "action": "disable"
}
```

**Respostas:**
| Status | Body | Descrição |
|--------|------|-----------|
| `200` | `{ "ok": true, "backupCodes": ["xxxx-xxxx", ...] }` | Ativação OK — lista códigos de backup |
| `200` | `{ "ok": true }` | Desativação OK |
| `400` | `{ "error": "..." }` | Código inválido, desafio expirado, etc. |

### 5.7 `POST /security/password`

Troca a senha do usuário logado. **Revoga todas as sessões** do usuário.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <jwt>
x-nio-gateway-token: <token>
```

**Body:**
```json
{
  "currentPassword": "senhaAntiga",
  "newPassword": "NovaSenhaSegura123!"
}
```

**Validações:**
- Senha nova ≥ `MIN_PASSWORD_LENGTH`
- Senha nova ≠ senha atual
- Senha nova verificada contra breaches (HaveIBeenPwned)
- Senha atual deve estar correta

**Respostas:**
| Status | Body | Descrição |
|--------|------|-----------|
| `200` | `{ "ok": true }` | Sucesso — todas as sessões anteriores revogadas |
| `400` | `{ "error": "..." }` | Validação falhou |

### 5.8 `GET /security/status`

Retorna o status completo de segurança do usuário.

**Headers:**
```
Authorization: Bearer <jwt>
x-nio-gateway-token: <token>
```

**Resposta:**
```json
{
  "enabled": true,
  "phoneHint": "+55•••••••8888",
  "backupCodesRemaining": 8,
  "regenerateBackupCodesRecommended": false,
  "recentIps": [
    { "ip": "192.168.0.50", "lastSeen": "2025-09-09T10:00:00.000Z", "count": 3 }
  ],
  "recentFailedAttempts": [
    { "at": "2025-09-09T09:55:00.000Z", "event": "2fa_fail", "ip": "192.168.0.50" }
  ],
  "sms": { "mode": "provider", "host": "https://graph.facebook.com/v25.0/..." }
}
```

**Campos:**
- `enabled`: 2FA ativado ou não
- `phoneHint`: telefone mascarado (DDI + últimos 4 dígitos)
- `backupCodesRemaining`: quantos códigos de backup restam
- `regenerateBackupCodesRecommended`: `true` se o pepper dos códigos é antigo
  (ADR 0011 §A) — recomenda regenerar
- `recentIps`: últimos 10 IPs de login
- `recentFailedAttempts`: últimas 5 tentativas de auth falhas
- `sms.mode`: `"provider"` | `"echo"` | `"unconfigured"`
- `sms.host`: URL do endpoint WhatsApp/Meta (null se não configurado)

### 5.9 `GET /health`

Health check — não requer token nem Bearer.

**Resposta:**
```json
{ "ok": true }
```

---

## 6. Variáveis de Ambiente

### Stack Docker Compose (variáveis do Portainer)

| Variável | Serviço | Default | Descrição |
|----------|---------|---------|-----------|
| `NIO_GATEWAY_TOKEN` | nio-gateway | — | Token do gateway (override do arquivo) |
| `DATABASE_URL` | nio-gateway | — | Connection string PostgreSQL (`postgresql://...`) |
| `JWT_SECRET` | nio-gateway | — | Chave HMAC para assinatura de JWTs (HS256) |
| `NIO_MAX_SESSIONS_PER_USER` | nio-gateway | `5` | Máximo de sessões ativas por usuário (SP-5) |
| `NIO_AUTH_EVENTS_RETENTION_DAYS` | nio-gateway | `180` | Dias de retenção da trilha de auth |
| `WHATSAPP_ENDPOINT_URL` | nio-gateway | — | URL do endpoint WhatsApp Business (Meta Graph); loopback (localhost/127.0.0.1) = modo echo |
| `WHATSAPP_TOKEN` | nio-gateway | — | Token de acesso (Bearer) da WhatsApp Business API |
| `WHATSAPP_TEMPLATE_NAME` | nio-gateway | `autenticao` | Template de autenticação |
| `WHATSAPP_TEMPLATE_LANGUAGE` | nio-gateway | `pt_BR` | Idioma do template |
| `SMTP_*` | nio-headroom | — | Configurações de email (Headroom proxy) |

### Gateway Token — Fontes de Dados (ordem de precedência)

1. **`NIO_GATEWAY_TOKEN`** (variável de ambiente) — prioridade máxima
2. **`~/.nio/gateway.token`** (arquivo no filesystem) — fallback

---

## 7. Deploy via Portainer

### Stack ID e URL

- **Portainer URL:** `https://192.168.0.160:9443/#!/3/docker/stacks/nio_cli277?id=106`
- **Stack ID:** 106
- **Imagem do gateway:** `ghcr.io/hugoreiis12-png/nio-gateway:v0.5.0`

### Arquivos de Compose

| Arquivo | Uso |
|---------|-----|
| `docker/docker-compose.deploy.yml` | Definição principal da stack (4 serviços) |
| `docker/kong.yml` | Kong declarativo (DB-less) — rotas, rate-limit |
| `docker/external-app.example.yml` | Template para apps externos em `nio-net` |

### Comandos de Deploy

#### Deploy inicial (Portainer UI)

1. Acessar Portainer → Stacks → Add stack
2. Nome: `nio_cli277`
3. Source: `Repository` → URL: `https://github.com/hugoreiis12-png/NIO-CLI-.git`
4. Compose path: `docker/docker-compose.deploy.yml`
5. Definir variáveis de ambiente na aba "Environment variables"
6. Deploy stack

#### Atualização via CLI

```bash
# Atualizar imagem na compose (CI atualiza automaticamente via workflow)
git tag v0.5.1 && git push origin v0.5.1

# Redeploy no Portainer
curl -k -X POST "https://192.168.0.160:9443/api/endpoints/1/docker/stacks/106/start" \
  -H "Authorization: Bearer <portainer_token>"
```

#### Redeploy via Portainer UI

1. Acessar stack `nio_cli277`
2. Clicar "Pull and redeploy"

---

## 8. Integração com Aplicação Externa

### Opção Recomendada: Docker Network `nio-net`

Aplicações que rodam em containers Docker podem se conectar à rede `nio-net`
e acessar diretamente Kong e os serviços internos.

#### Template: `docker/external-app.example.yml`

```yaml
version: "3.9"

services:
  minha-api:
    image: minha-api:latest
    container_name: minha-api
    environment:
      NIO_KONG_URL: "http://nio-kong:8000"
      NIO_GATEWAY_URL: "http://nio-gateway:3000"
      NIO_HEADROOM_URL: "http://nio-headroom:8787"
      NIO_GATEWAY_TOKEN: "f6df401be8ac6f19149f6d7779845d299a3b804648b0896752f76e2d90eb23cc"
    networks:
      - nio-net

networks:
  nio-net:
    external: true
```

#### Exemplo de Requisição (cURL via Docker)

```bash
# Registrando usuário
curl -X POST http://nio-kong:8000/register \
  -H "Content-Type: application/json" \
  -H "x-nio-gateway-token: f6df401be8ac6f19149f6d7779845d299a3b804648b0896752f76e2d90eb23cc" \
  -d '{"name":"usuario1","password":"SenhaSegura123!"}'

# Login (1º fator)
curl -X POST http://nio-kong:8000/login \
  -H "Content-Type: application/json" \
  -H "x-nio-gateway-token: f6df401be8ac6f19149f6d7779845d299a3b804648b0896752f76e2d90eb23cc" \
  -d '{"name":"usuario1","password":"SenhaSegura123!"}'

# Verificar status 2FA (com JWT)
curl -X GET http://nio-kong:8000/security/status \
  -H "Authorization: Bearer <jwt_token>" \
  -H "x-nio-gateway-token: f6df401be8ac6f19149f6d7779845d299a3b804648b0896752f76e2d90eb23cc"
```

#### Acesso via IP da LAN

```bash
# Kong (porta 8000)
curl -X GET http://192.168.0.160:8000/health

# Headroom (porta 8787)
curl -X GET http://192.168.0.160:8787/health
```

### Headers Obrigatórios

| Header | Necessário em | Descrição |
|--------|---------------|-----------|
| `x-nio-gateway-token` | Todas exceto `/health` | Token de autenticação do gateway |
| `Authorization: Bearer <jwt>` | `/logout`, `/security/*` | JWT emitido pelo login |
| `Content-Type: application/json` | Todos com body | Formato do payload |

---

## 9. Troubleshooting

### 9.1 Erro `403 Forbidden`

**Causa mais comum:** header `x-nio-gateway-token` ausente ou incorreto.

```bash
# Verificar se o token está correto
curl -s -X GET http://192.168.0.160:8000/health

# Testar com token explícito
curl -s -X POST http://192.168.0.160:8000/login \
  -H "x-nio-gateway-token: SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","password":"test"}'
```

### 9.2 Erro `429 Too Many Requests`

**Causa:** rate limit do Kong atingido.

```bash
# Verificar headers de rate limit
curl -sI -X POST http://192.168.0.160:8000/login \
  -H "Content-Type: application/json" \
  -H "x-nio-gateway-token: TOKEN" \
  -d '{"name":"test","password":"test"}'

# Resposta incluirá:
# RateLimit-Limit: 20
# RateLimit-Remaining: 19
# RateLimit-Reset: 1693847460
```

### 9.3 Erro `500` no Login

**Possíveis causas:**
- `WHATSAPP_ENDPOINT_URL` / `WHATSAPP_TOKEN` não configurados (se 2FA habilitado)
- WhatsApp provider (Meta Graph) indisponível
- Banco de dados PostgreSQL inacessível

### 9.4 Portainer: Erro `line 5: key cannot contain space`

**Causa:** variável de ambiente com espaço na chave (ex: `KEY = value`).

**Solução:** garantir formato `KEY=value` (sem espaços ao redor do `=`):

```env
NIO_GATEWAY_TOKEN=f6df401be8ac6f19149f6d7779845d299a3b804648b0896752f76e2d90eb23cc
DATABASE_URL=postgresql://nio_user:senha@db:5432/nio_cli
```

### 9.5 Imagem Docker Desatualizada

Se o código de environment variable não está funcionando, verifique a versão
da imagem:

```bash
# Verificar tag atual no compose
grep "image:" docker/docker-compose.deploy.yml

# Versão atual: v0.5.0 (possivelmente desatualizada)
# Necessário rebuild com tag v0.5.1 para incluir suporte a env var
```

### 9.6 Conexão Recusada com Kong

```bash
# Verificar se Kong está rodando
docker ps | grep nio-kong

# Verificar logs do Kong
docker logs nio-kong

# Verificar se Kong pode acessar o gateway
docker exec nio-kong curl -s http://nio-gateway:3000/health
```

### 9.7 Aplicação Externa Não Conecta

```bash
# Verificar se a rede nio-net existe
docker network inspect nio-net

# Verificar se o container está na rede correta
docker inspect <container_name> | grep -A 5 "Networks"

# Verificar resolução DNS dentro do container
docker exec <container_name> nslookup nio-kong
```

---

## Referências

- **Specs de Auth:** `docs/specs/auth/0004-login-2fa-sms-otp.md`
- **ADR 0006:** Autenticação via SMS OTP
- **ADR 0011:** Pepper rotation para backup codes
- **ADR 0012:** Trilha de eventos de autenticação
- **ARQUITETURA-GATEWAY.md:** Visão geral do gateway
- **ARQUITETURA-DOCKER.md:** Visão geral do deploy Docker
- **Portainer Stack:** `https://192.168.0.160:9443/#!/3/docker/stacks/nio_cli277?id=106`
