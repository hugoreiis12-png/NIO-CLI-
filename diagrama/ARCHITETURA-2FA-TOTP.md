# NIO-CLI — Arquitetura de 2º Fator (TOTP + Backup Codes)

> ⚠️ **NÃO É O CAMINHO ESCOLHIDO.** O 2º fator da v1 é **SMS OTP** — o dono quer
> uma *mensagem de confirmação*, e TOTP não envia nada. Ver
> [spec 0004](../docs/specs/auth/0004-login-2fa-sms-otp.md) e [ADR 0006](../docs/adr/0006-2fa-sms-otp.md).
> **O que foi aproveitado deste doc:** o sketch de **códigos de backup** (§4.2) e
> os nomes de comando/rota (`nio security …`, `/verify-2fa`, `/security/*`).

> Documento de arquitetura para implementação do 2FA open-source no NIO-CLI.
> Baseado na esteira de autenticação existente (JWT + auth_sessions + gateway HTTP).
> Data: 2026-08-25

---

## 1. Visão Geral

### 1.1 O que é

Adicionar um 2º fator de autenticação ao fluxo de login do NIO-CLI, utilizando:
- **TOTP** (Time-based One-Time Password) — códigos de 6 dígitos, válidos por 30s
- **Backup Codes** — 10 códigos de uso único como fallback

### 1.2 Por que TOTP + Backup Codes (e não SMS/Twilio)

| Aspecto | TOTP + Backup Codes | SMS (Twilio) |
|---|---|---|
| Custo por login | Grátis | ~$0.11 por SMS |
| NIST SP 800-63B | **AAL2** (Authenticator Assurance Level 2) | Restricted Authenticator |
| Infraestrutura extra | Nenhuma (sÓ biblioteca) | Conta Twilio + API |
| Riscos de segurança | Apenas se perder o celular | SIM swap, interceptação de rede |
| Fallback | Backup codes já inclusos | Precisaria de TOTP como fallback anyway |
| Maturidade | Battle-tested (Google, GitHub, 1Password) | Depende de terceiros |

### 1.3 Compatibilidade com app autenticador

O TOTP gerado é compatível com:
- Google Authenticator
- Authy
- 1Password
- Microsoft Authenticator
- Qualquer app que leia QR code ou segredo manual

---

## 2. Arquitetura de Alto Nível

### 2.1 Diagrama de Fluxo Completo

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              LOGIN COMPLETO                                    │
│                                                                               │
│  $ nio login                                                                │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  POST /auth/login                                                   │     │
│  │  { "name": "hugo", "password": "***" }                            │     │
│  └──────────────────────────┬──────────────────────────────────────────┘     │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  GATEWAY                                                             │     │
│  │  ├── UserRepo.verifyCredentials (argon2id)                         │     │
│  │  ├── user.auth_2_enabled == false?                                  │     │
│  │  │                                                                    │     │
│  │  │   ├── SIM ──► auth_sessions.create ──► JWT.sign ──► Step 4      │     │
│  │  │   │                                                              │     │
│  │  │   └── NAO ──► Step 2 (2FA)                                       │     │
│  └──────┴───────────────────────────────────────────────────────────────┘     │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  Response: { "step": "2fa_required", "pendingSessionId": "uuid" } │     │
│  └──────────────────────────┬──────────────────────────────────────────┘     │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  CLI detecta "step: 2fa_required"                                  │     │
│  │  ? Código TOTP: [______]  (6 dígitos)                              │     │
│  │                                                                      │     │
│  │  (Se 3 tentativas falharem)                                         │     │
│  │  ? Código de backup: [________]  (8 caracteres)                    │     │
│  └──────────────────────────┬──────────────────────────────────────────┘     │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  POST /auth/verify-2fa                                              │     │
│  │  { "pendingSessionId": "uuid", "code": "123456" }                 │     │
│  └──────────────────────────┬──────────────────────────────────────────┘     │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  GATEWAY                                                             │     │
│  │  ├── Busca pending session por id                                    │     │
│  │  │                                                                    │     │
│  │  ├── TENTATIVA TOTP:                                                │     │
│  │  │   ├── totp.verify(code, secret_descriptografado)                 │     │
│  │  │   │                                                               │     │
│  │  │   ├── ✓ CORRETO ──► pending session marcada como "usada" ──► 4  │     │
│  │  │   │                                                               │     │
│  │  │   └── ✗ INCORRETO ──► tentativas++                              │     │
│  │  │                      │                                             │     │
│  │  │                      ├── tentativas < 3 ──► "código inválido"   │     │
│  │  │                      └── tentativas >= 3 ──► Step BACKUP CODE    │     │
│  │  │                                                                    │     │
│  │  └── FALLBACK BACKUP CODE (após 3 falhas de TOTP):                  │     │
│  │      ├── bcrypt.compare(code, backup_code_hash)                     │     │
│  │      │                                                                │     │
│  │      ├── ✓ CORRETO ──► JWT.emitido, backup code marcado como USADO │     │
│  │      └── ✗ INCORRETO ──► "código de backup inválido ou já usado"  │     │
│  └──────────────────────────────────────────────────────────────────────┘     │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  Response: { "step": "done", "token": "jwt...", ... }            │     │
│  └──────────────────────────┬──────────────────────────────────────────┘     │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  ~/.nio/session.json                                                │     │
│  │  ~/.nio/config.json                                                 │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Diagrama — Ativação do 2FA

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     ATIVAÇÃO DO 2FA ($ nio security enable-2fa)                │
│                                                                               │
│  $ nio security enable-2fa                                                   │
│       │                                                                      │
│       ▼                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  CLI                                                                   │  │
│  │  ├── Verifica se já está logado                                       │  │
│  │  │   ├── NÃO logado ──► "rode nio login primeiro"                     │  │
│  │  │   └── LOGADO ──► continua                                          │  │
│  │  ├── Verifica se 2FA já está ativo                                    │  │
│  │  │   ├── JÁ ATIVO ──► "2FA já está ativado. Use disable-2fa para reset"│  │
│  │  │   └── NAO ATIVO ──► continua                                        │  │
│  │  └── POST /auth/security/enable-2fa                                    │  │
│  └──────────────────────────┬───────────────────────────────────────────────┘  │
│       │                                                                      │
│       ▼                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  GATEWAY                                                               │  │
│  │  ├── Gera TOTP secret (base32, 20 bytes)                             │  │
│  │  ├── Gera 10 backup codes (8 caracteres cada)                         │  │
│  │  ├── Criptografa TOTP secret com AES-256-GCM                         │  │
│  │  ├── Faz hash de cada backup code (bcrypt)                           │  │
│  │  ├── Salva em user_cli                                               │  │
│  │  └── Marca user.auth_2_enabled = true                                │  │
│  └──────────────────────────┬───────────────────────────────────────────────┘  │
│       │                                                                      │
│       ▼                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  Response:                                                            │  │
│  │  {                                                                    │  │
│  │    "totpSecret": "JBSWY3DPEHPK3PXP",    // base32, pra QR ou entrada │  │
│  │    "otpauthUrl": "otpauth://totp/NIO:hugo?secret=JBSWY3D...",         │  │
│  │    "backupCodes": [                                                   │  │
│  │      "ABCD1234", "EFGH5678", ...  // 10 códigos, mostra 1x só       │  │
│  │    ]                                                                  │  │
│  │  }                                                                    │  │
│  └──────────────────────────┬───────────────────────────────────────────────┘  │
│       │                                                                      │
│       ▼                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  CLI exibe:                                                           │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────┐     │  │
│  │  │  ⚠️  GUARDE ESTES CÓDIGOS EM LOCAL SEGURO                    │     │  │
│  │  │                                                               │     │  │
│  │  │  Código 1: ABCD1234                                          │     │  │
│  │  │  Código 2: EFGH5678                                          │     │  │
│  │  │  ...                                                           │     │  │
│  │  │  Códigos restantes: 10                                        │     │  │
│  │  │                                                               │     │  │
│  │  │  Cada código pode ser usado APENAS UMA VEZ.                  │     │  │
│  │  └──────────────────────────────────────────────────────────────┘     │  │
│  │                                                                        │  │
│  │  Escaneie o QR code com seu app autenticador:                        │  │
│  │                                                                        │  │
│  │  ┌─────────────────┐                                                 │  │
│  │  │   [QR CODE]     │  ← Exibido no terminal (ASCII art ou imagem)  │  │
│  │  │                 │                                                 │  │
│  │  └─────────────────┘                                                 │  │
│  │                                                                        │  │
│  │  Ou digite manualmente:                                               │  │
│  │  JBSWY3DPEHPK3PXP                                                    │  │
│  │                                                                        │  │
│  │  ? Confirme com um código TOTP: [______]                             │  │
│  │                                                                        │  │
│  │  2FA ativado com sucesso! ✅                                          │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Modelo de Dados

### 3.1 Alterações no Schema (Postgres)

```sql
-- Migration 0003: TOTP 2FA

BEGIN;

-- Coluna: segredo TOTP criptografado (AES-256-GCM)
-- NULL = 2FA desativado
-- Formato: base64(iv):base64(ciphertext):base64(authTag)
ALTER TABLE user_cli
  ADD COLUMN totp_secret_encrypted TEXT;

-- Coluna: códigos de backup (bcrypt hash, separados por |)
-- NULL = não gerados
-- Armazenado como: $2b$12$hash1|$2b$12$hash2|...|$2b$12$hash10
ALTER TABLE user_cli
  ADD COLUMN backup_codes_encrypted TEXT;

-- Coluna: flag de 2FA ativo
-- NULL = false (default)
ALTER TABLE user_cli
  ADD COLUMN auth_2_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Coluna: contagem de tentativas TOTP (reseta a cada login)
-- NULL = 0
ALTER TABLE user_cli
  ADD COLUMN totp_attempts INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN user_cli.totp_secret_encrypted IS
  'Segredo TOTP criptografado com AES-256-GCM (chave derivada do JWT_SECRET).
   Formato: base64(iv):base64(ciphertext):base64(authTag). NULL = 2FA desativado.';

COMMENT ON COLUMN user_cli.backup_codes_encrypted IS
  'Hash bcrypt de cada código de backup (10 códigos de 8 chars).
   Separados por |. NULL = não gerados. Cada código pode ser usado apenas 1x.';

COMMENT ON COLUMN user_cli.auth_2_enabled IS
  'TRUE = 2FA TOTP ativo. FALSE ou NULL = desativado.';

COMMENT ON COLUMN user_cli.totp_attempts IS
  'Contagem de tentativas TOTP inválidas neste ciclo de login. Reseta a cada novo login.';

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_user_cli_auth2 ON user_cli(auth_2_enabled) WHERE auth_2_enabled = TRUE;

COMMIT;
```

### 3.2 Entidade Atualizada (core/session.ts)

```typescript
// Nova interface (adicionar ao arquivo existente)
export interface UserCli {
  id: number;
  name: string;
  password: string; // hash argon2id, nunca exposto fora do adapter
  auth2: boolean;
  auth2Enabled: boolean;       // ← NOVO: TOTP ativo?
  totpSecretEncrypted: string | null; // ← NOVO: criptografado
  backupCodesEncrypted: string | null; // ← NOVO: bcrypt hashes
  totpAttempts: number;       // ← NOVO: tentativas neste ciclo
  tokenSession: string | null;
  ipsUsing: string[];
  timestampCreation: Date;
  timestampPasswordChange: Date | null;
  timestampLastSession: Date | null;
}
```

### 3.3 Pending Session (auth_sessions)

```sql
-- Adicionar coluna em auth_sessions para pending 2FA
ALTER TABLE auth_sessions
  ADD COLUMN pending_2fa BOOLEAN NOT NULL DEFAULT FALSE;

-- Quando pending_2fa = true, o JWT ainda não foi emitido
-- Quando pending_2fa = false E revoked_at = NULL, JWT está válido
```

---

## 4. Serviços (src/lib/)

### 4.1 src/lib/totp.ts

```typescript
/**
 * Geração e verificação de TOTP.
 * Usa otplib (compatible RFC 6238).
 * Segredo armazenado criptografado no banco; descriptografado apenas em memória.
 */
import { authenticator } from 'otplib';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Configuração TOTP
const TOTP_PERIOD = 30;      // 30 segundos por código
const TOTP_DIGITS = 6;       // 6 dígitos
const TOTP_ISSUER = 'NIO-CLI';
const TOTP_ALGORITHM = 'SHA1'; // Padrão Google Authenticator

// AES-256-GCM para criptografia do segredo
const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;        // 96 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

// Deriva chave de criptografia do JWT_SECRET
function deriveEncryptionKey(secret: string): Buffer {
  return scryptSync(secret, 'nio-totp-salt', 32);
}

/**
 * Gera um segredo TOTP em base32.
 * @param userName - nome do usuário (pra mostrar no app autenticador)
 * @returns { secret: base32, otpauthUrl: string }
 */
export function generateTOTPSecret(userName: string): {
  secret: string;
  otpauthUrl: string;
} {
  const secret = authenticator.generateSecret(20); // 160 bits, RFC  recommendation
  const otpauthUrl = authenticator.keyuri(userName, TOTP_ISSUER, secret);
  return { secret, otpauthUrl };
}

/**
 * Criptografa o segredo TOTP com AES-256-GCM.
 * @param secret - segredo em base32
 * @param jwtSecret - JWT_SECRET (chave de criptografia)
 * @returns "iv:ciphertext:authTag" em base64
 */
export function encryptTOTPSecret(secret: string, jwtSecret: string): string {
  const key = deriveEncryptionKey(jwtSecret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  
  let ciphertext = cipher.update(secret, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('base64')}:${ciphertext}:${authTag.toString('base64')}`;
}

/**
 * Descriptografa o segredo TOTP.
 * @param encrypted - "iv:ciphertext:authTag" em base64
 * @param jwtSecret - JWT_SECRET
 * @returns segredo em base32
 */
export function decryptTOTPSecret(encrypted: string, jwtSecret: string): string {
  const [ivB64, ciphertextB64, authTagB64] = encrypted.split(':');
  if (!ivB64 || !ciphertextB64 || !authTagB64) {
    throw new Error('Formato de TOTP criptografado inválido');
  }
  
  const key = deriveEncryptionKey(jwtSecret);
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let plaintext = decipher.update(ciphertext);
  plaintext = Buffer.concat([plaintext, decipher.final()]);
  
  return plaintext.toString('utf8');
}

/**
 * Verifica um código TOTP.
 * @param code - código de 6 dígitos informado pelo usuário
 * @param encryptedSecret - segredo criptografado
 * @param jwtSecret - JWT_SECRET
 * @returns true se o código é válido
 */
export function verifyTOTP(
  code: string,
  encryptedSecret: string,
  jwtSecret: string,
): boolean {
  try {
    const secret = decryptTOTPSecret(encryptedSecret, jwtSecret);
    return authenticator.verify({ token: code.trim(), secret });
  } catch {
    return false;
  }
}

/**
 * Verifica se o código tem o formato esperado (6 dígitos numéricos).
 * @param code
 * @returns true se formato válido
 */
export function isValidTOTPFormat(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}
```

### 4.2 src/lib/backup-codes.ts

```typescript
/**
 * Geração e verificação de backup codes.
 * Cada código: 8 caracteres alfanuméricos (A-Z, 0-9, exceto confusos: 0/O, 1/I/L)
 * Hash com bcrypt (same config que argon2id usa pro password).
 */
import { compare, hashSync, genSaltSync } from 'bcryptjs';

const BACKUP_CODE_LENGTH = 8;
const BACKUP_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10;

// Caracteres legíveis (sem 0/O, 1/I/L para não confundir)
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Gera um código de backup aleatório.
 */
function generateBackupCode(): string {
  const bytes = require('node:crypto').randomBytes(BACKUP_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    code += CHARS[bytes[i] % CHARS.length]!;
  }
  return code;
}

/**
 * Gera 10 backup codes e seus hashes.
 * @returns { codes: string[], hashedCodes: string[] }
 *codes: apenas para exibição (mostrar 1x só)
 *hashedCodes: para armazenamento (separados por |)
 */
export function generateBackupCodes(): {
  codes: string[];
  hashedCodes: string;
} {
  const codes: string[] = [];
  const hashes: string[] = [];
  
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = generateBackupCode();
    codes.push(code);
    // Hash com bcrypt (mesma rounds que password)
    hashes.push(hashSync(code, genSaltSync(BCRYPT_ROUNDS)));
  }
  
  return {
    codes,
    hashedCodes: hashes.join('|'),
  };
}

/**
 * Verifica um código de backup e retorna qual posição foi usada.
 * @param inputCode - código digitado pelo usuário (case-insensitive)
 * @param storedHashes - hashes separados por |
 * @returns índice do código usado (0-9), ou -1 se inválido
 */
export function verifyBackupCode(
  inputCode: string,
  storedHashes: string,
): number {
  const normalized = inputCode.trim().toUpperCase();
  const hashes = storedHashes.split('|');
  
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    if (!hash) continue;
    
    // Verifica se já foi usado (hash replaced por vazio)
    if (hash === '[USED]') continue;
    
    if (compare(normalized, hash)) {
      return i;
    }
  }
  
  return -1; // inválido ou já usado
}

/**
 * Marca um backup code como usado (substitui o hash por '[USED]').
 * @param storedHashes
 * @param usedIndex
 * @returns novo valor pra salvar no banco
 */
export function markBackupCodeUsed(
  storedHashes: string,
  usedIndex: number,
): string {
  const hashes = storedHashes.split('|');
  hashes[usedIndex] = '[USED]';
  return hashes.join('|');
}

/**
 * Verifica se todos os backup codes já foram usados.
 * @param storedHashes
 * @returns true se nenhum disponível
 */
export function allBackupCodesUsed(storedHashes: string): boolean {
  const hashes = storedHashes.split('|');
  return hashes.every(h => h === '[USED]' || !h);
}

/**
 * Verifica se o backup code tem formato válido (8 chars alfanumérico).
 * @param code
 * @returns true se válido
 */
export function isValidBackupCodeFormat(code: string): boolean {
  const cleaned = code.trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(cleaned);
}
```

---

## 5. Gateway (HTTP Routes)

### 5.1 src/gateway/routes/auth.ts (adições)

```typescript
// Adicionar ao arquivo existente

interface Verify2FABody {
  pendingSessionId: string;
  code: string;
  type: 'totp' | 'backup';
}

async function handleVerify2FA(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody<Verify2FABody>(req);
  
  // Validações básicas
  if (!body.pendingSessionId || !body.code) {
    sendJson(res, 400, { error: 'pendingSessionId e code são obrigatórios' });
    return;
  }
  
  if (!['totp', 'backup'].includes(body.type)) {
    sendJson(res, 400, { error: 'type deve ser "totp" ou "backup"' });
    return;
  }
  
  // Busca pending session
  const authSessions = createAuthSessionRepository();
  const session = await authSessions.findById(body.pendingSessionId);
  
  if (!session) {
    sendJson(res, 404, { error: 'sessão pendente não encontrada ou expirada' });
    return;
  }
  
  if (!session.pending2fa) {
    sendJson(res, 400, { error: 'sessão não está em espera de 2FA' });
    return;
  }
  
  // Busca usuário
  const users = createUserRepository();
  const user = await users.findByNameById(session.userId); // método novo
  
  if (!user) {
    sendJson(res, 401, { error: 'usuário não encontrado' });
    return;
  }
  
  // ===== VERIFICAÇÃO TOTP =====
  if (body.type === 'totp') {
    if (!isValidTOTPFormat(body.code)) {
      sendJson(res, 400, { error: 'código TOTP inválido (deve ter 6 dígitos)' });
      return;
    }
    
    if (!user.totpSecretEncrypted) {
      sendJson(res, 400, { error: 'TOTP não configurado para este usuário' });
      return;
    }
    
    const isValid = verifyTOTP(body.code, user.totpSecretEncrypted, getJwtSecret());
    
    if (!isValid) {
      // Incrementa tentativas
      await users.incrementTOTPAttempts(user.id);
      const updatedUser = await users.findById(user.id);
      
      const remaining = 3 - (updatedUser?.totpAttempts ?? 0);
      
      if (remaining <= 0) {
        // Esgota tentativas TOTP, usuário DEVE usar backup code
        sendJson(res, 429, { 
          error: 'tentativas TOTP esgotadas',
          reason: 'totp_exhausted',
          requiresBackupCode: true,
        });
      } else {
        sendJson(res, 401, { 
          error: `código TOTP inválido (${remaining} tentativas restantes)`,
          reason: 'totp_invalid',
          remainingAttempts: remaining,
        });
      }
      return;
    }
    
    // TOTP válido → emite JWT
    await users.resetTOTPAttempts(user.id);
    await authSessions.completePending2FA(session.id);
    const { token, expiresAt } = await createJWT(user, session.id);
    
    sendJson(res, 200, {
      step: 'done',
      token,
      userId: user.id,
      name: user.name,
      sessionId: session.id,
      expiresAt: expiresAt.toISOString(),
    });
    return;
  }
  
  // ===== VERIFICAÇÃO BACKUP CODE =====
  if (body.type === 'backup') {
    if (!isValidBackupCodeFormat(body.code)) {
      sendJson(res, 400, { error: 'código de backup inválido (deve ter 8 caracteres)' });
      return;
    }
    
    if (!user.backupCodesEncrypted) {
      sendJson(res, 400, { error: 'códigos de backup não configurados' });
      return;
    }
    
    const usedIndex = verifyBackupCode(body.code, user.backupCodesEncrypted);
    
    if (usedIndex === -1) {
      sendJson(res, 401, { error: 'código de backup inválido ou já utilizado' });
      return;
    }
    
    // Marca código como usado e emite JWT
    const newHashes = markBackupCodeUsed(user.backupCodesEncrypted, usedIndex);
    await users.updateBackupCodes(user.id, newHashes);
    await authSessions.completePending2FA(session.id);
    const { token, expiresAt } = await createJWT(user, session.id);
    
    sendJson(res, 200, {
      step: 'done',
      token,
      userId: user.id,
      name: user.name,
      sessionId: session.id,
      expiresAt: expiresAt.toISOString(),
      backupCodesRemaining: countRemainingCodes(newHashes),
    });
    return;
  }
}
```

### 5.2 Nova rota — security

```typescript
// src/gateway/routes/security.ts

interface Enable2FABody {
  totpCode: string; // confirmação antes de ativar
}

async function handleEnable2FA(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = extractBearerToken(authHeader);
  
  if (!token) {
    sendJson(res, 401, { error: 'não autenticado' });
    return;
  }
  
  // Valida token existente (precisa estar logado pra ativar 2FA)
  const authResult = await authenticate(token);
  if (!authResult.ok) {
    sendJson(res, 401, { error: 'sessão inválida' });
    return;
  }
  
  const users = createUserRepository();
  const user = await users.findById(authResult.userId);
  
  if (!user) {
    sendJson(res, 401, { error: 'usuário não encontrado' });
    return;
  }
  
  if (user.auth2Enabled) {
    sendJson(res, 400, { error: '2FA já está ativado' });
    return;
  }
  
  const body = await readJsonBody<Enable2FABody>(req);
  
  // Gera segredo TOTP
  const { secret, otpauthUrl } = generateTOTPSecret(user.name);
  const { codes, hashedCodes } = generateBackupCodes();
  
  // Criptografa e salva
  const encryptedSecret = encryptTOTPSecret(secret, getJwtSecret());
  await users.enable2FA(user.id, encryptedSecret, hashedCodes);
  
  sendJson(res, 200, {
    totpSecret: secret,
    otpauthUrl,
    backupCodes: codes,
    message: 'Guarde os códigos de backup em local seguro. Cada um só pode ser usado uma vez.',
  });
}

async function handleDisable2FA(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Similar: exige token + senha + código TOTP válido
  // Regenera novos backup codes após reativar
}

async function handle2FAStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Retorna: { enabled: boolean, backupCodesRemaining: number }
}
```

---

## 6. CLI (commands)

### 6.1 src/cli/commands/auth.ts (adaptação)

```typescript
async function loginAction() {
  const name = await input({ message: authCopy.login.namePrompt });
  const pass = await password({ message: authCopy.login.passwordPrompt, mask: '*' });

  const spinner = startSpinner('Autenticando...');
  try {
    const result = await gatewayLogin(name.trim(), pass);

    if (!result) {
      spinner.fail(authCopy.login.invalidCredentials);
      process.exit(1);
    }

    // ===== FLUXO 2FA =====
    if (result.step === '2fa_required') {
      spinner.stop();

      // Mostra quantas tentativas TOTP restam
      let attempts = 3;
      let useBackup = false;

      while (true) {
        if (useBackup) {
          // Prompt de backup code
          const backupCode = await password({
            message: `Tentativas TOTP esgotadas. Use um código de backup (${attempts} restantes):`,
            mask: '*',
          });

          const verifyResult = await gatewayVerify2FA(
            result.pendingSessionId,
            backupCode,
            'backup',
          );

          if (verifyResult.ok) {
            await saveSession({ ...verifyResult });
            break;
          }

          attempts--;
          if (attempts <= 0) {
            console.error('Código de backup inválido ou já utilizado.');
            process.exit(1);
          }
          console.error(`Código inválido. Tentativas restantes: ${attempts}`);
          continue;
        }

        // Prompt TOTP
        const totpCode = await input({
          message: 'Código TOTP (6 dígitos):',
        });

        if (!/^\d{6}$/.test(totpCode)) {
          console.error('Código deve ter 6 dígitos numéricos.');
          continue;
        }

        const verifyResult = await gatewayVerify2FA(
          result.pendingSessionId,
          totpCode,
          'totp',
        );

        if (verifyResult.ok) {
          await saveSession({ ...verifyResult });
          break;
        }

        if (verifyResult.requiresBackupCode) {
          useBackup = true;
          console.error('Tentativas TOTP esgotadas. Use um código de backup.');
          continue;
        }

        if (verifyResult.remainingAttempts !== undefined) {
          console.error(
            `Código inválido. Tentativas restantes: ${verifyResult.remainingAttempts}`,
          );
          continue;
        }

        console.error(verifyResult.error);
        process.exit(1);
      }
    }

    // ===== LOGIN DIRETO (sem 2FA) =====
    if (result.step === 'done') {
      await saveSession({
        userId: result.userId,
        name: result.name,
        token: result.token,
        sessionId: result.sessionId,
        loggedInAt: new Date().toISOString(),
        expiresAt: result.expiresAt,
      });
    }

    spinner.stop();
    console.log(renderMatrixLogo());
    console.log('[ok] Autenticado!');
    console.log(`Usuário: ${result.name}`);
    console.log(`ID:      ${result.userId}`);

  } catch (err) {
    spinner.fail(`Falha ao autenticar: ${(err as Error).message}`);
    process.exit(1);
  }
}
```

### 6.2 src/cli/commands/security.ts (novo)

```typescript
/**
 * $ nio security enable-2fa
 * $ nio security disable-2fa
 * $ nio security status
 * $ nio security regenerate-backup-codes
 */
import type { Command } from 'commander';
import { input, password, isCancel } from '../../lib/prompts.js';
import { brand } from '../../brand.js';
import { loadSession } from '../../lib/session-store.js';
import { gatewaySecurity } from '../../lib/gateway-client.js';
import { renderMatrixLogo } from '../../matrix-logo.js';
import boxen from 'boxen';

function registerSecurityCommands(program: Command): void {
  // ---- enable-2fa ----
  program
    .command('enable-2fa')
    .description('Ativa o 2º fator de autenticação (TOTP + códigos de backup)')
    .action(async () => {
      const session = await loadSession();
      if (!session) {
        console.error(`Não autenticado. Rode \`${brand.name} login\` primeiro.`);
        process.exit(1);
      }

      const spinner = startSpinner('Ativando 2FA...');
      try {
        const { totpSecret, otpauthUrl, backupCodes } = await gatewaySecurity.enable2FA(
          session.token,
        );

        spinner.stop();

        // Exibe backup codes
        const backupBox = boxen(
          [
            '⚠️  GUARDE ESTES CÓDIGOS EM LOCAL SEGURO',
            '',
            ...backupCodes.map((c, i) => `  ${String(i + 1).padStart(2, '0')}. ${c}`),
            '',
            'Cada código pode ser usado apenas UMA VEZ.',
            'Após usar todos, regenerated novos códigos.',
          ].join('\n'),
          { padding: 1, borderStyle: 'bold', borderColor: 'yellow' },
        );
        console.log(backupBox);

        // Exibe QR code (se terminal suportar)
        // Alternativa: mostra URL OTPauth
        console.log('Escaneie com seu app autenticador (Google Authenticator, Authy, 1Password):\n');
        console.log(`URL manual: ${otpauthUrl}\n`);
        console.log(`Segredo: ${totpSecret}\n`);

        // Confirma com código TOTP
        let attempts = 3;
        while (attempts > 0) {
          const confirmCode = await input({
            message: `Confirme com um código TOTP (${attempts} tentativas):`,
          });

          if (!/^\d{6}$/.test(confirmCode)) {
            console.error('Código deve ter 6 dígitos.');
            continue;
          }

          const confirmResult = await gatewaySecurity.confirmEnable2FA(
            session.token,
            confirmCode,
          );

          if (confirmResult.ok) {
            console.log(renderMatrixLogo());
            console.log('[ok] 2FA ativado com sucesso! ✅');
            console.log(`Códigos de backup restantes: ${confirmResult.backupCodesRemaining}`);
            return;
          }

          attempts--;
          console.error(`Código inválido. Tentativas restantes: ${attempts}`);
        }

        console.error('Ativação cancelada (código de confirmação inválido).');
        process.exit(1);

      } catch (err) {
        spinner.fail(`Erro: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // ---- disable-2fa ----
  program
    .command('disable-2fa')
    .description('Desativa o 2º fator de autenticação')
    .action(async () => {
      // Exige: senha + código TOTP válido
      // Mostra aviso de segurança
    });

  // ---- status ----
  program
    .command('status')
    .description('Mostra o status do 2FA')
    .action(async () => {
      const session = await loadSession();
      if (!session) {
        console.error(`Não autenticado.`);
        process.exit(1);
      }

      const status = await gatewaySecurity.getStatus(session.token);
      console.log(renderMatrixLogo());
      console.log(`2FA Status: ${status.enabled ? '✅ Ativado' : '❌ Desativado'}`);
      if (status.enabled) {
        console.log(`Códigos de backup restantes: ${status.backupCodesRemaining}`);
      }
    });

  // ---- regenerate-backup-codes ----
  program
    .command('regenerate-backup-codes')
    .description('Gera novos códigos de backup (exige TOTP)')
    .action(async () => {
      // Exige TOTP, gera 10 novos códigos
    });
}

export function registerSecurityCommands(program: Command): void {
  // implementations above
}
```

---

## 7. Gateway Client (src/lib/gateway-client.ts)

```typescript
// Adições ao arquivo existente

export interface GatewayVerify2FResult {
  ok: true;
  token: string;
  userId: number;
  name: string;
  sessionId: string;
  expiresAt: string;
  backupCodesRemaining?: number;
}

export interface GatewayVerify2FError {
  ok: false;
  error: string;
  reason?: 'totp_invalid' | 'totp_exhausted' | 'backup_invalid';
  remainingAttempts?: number;
  requiresBackupCode?: boolean;
}

export async function gatewayVerify2FA(
  pendingSessionId: string,
  code: string,
  type: 'totp' | 'backup',
): Promise<GatewayVerify2FResult | GatewayVerify2FError> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/auth/verify-2fa`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ pendingSessionId, code, type }),
    });
  } catch (err) {
    throw unreachableError(err);
  }

  const body = await res.json();
  if (res.status === 429 || res.status === 401) {
    return { ok: false, ...body };
  }
  if (!res.ok) throw new Error(body.error);
  return { ok: true, ...body };
}

// Funções de security
export async function gatewaySecurityEnable2FA(token: string) { /* ... */ }
export async function gatewaySecurityDisable2FA(token: string, password: string, totpCode: string) { /* ... */ }
export async function gatewaySecurityStatus(token: string) { /* ... */ }
```

---

## 8. Dependências

### 8.1 package.json (adições)

```json
{
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "otplib": "^12.0.1",
    "boxen": "^7.1.1",
    "qrcode": "^1.5.3"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/qrcode": "^1.5.5"
  }
}
```

### 8.2 Instalação

```bash
npm i bcryptjs otplib qrcode
npm i -D @types/bcryptjs @types/qrcode
```

---

## 9. Fluxo de Estados (State Machine)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    STATE MACHINE — 2FA LOGIN                             │
│                                                                          │
│   ┌──────────────┐                                                      │
│   │  INIT        │                                                      │
│   └──────┬───────┘                                                      │
│          │ POST /login (name + password)                                 │
│          ▼                                                               │
│   ┌──────────────────────┐                                               │
│   │ CREDENTIALS_VALID?   │                                              │
│   └──────────┬───────────┘                                               │
│         yes/ \no                                                         │
│          /    \                                                         │
│         ▼     ▼                                                         │
│  ┌──────────┐  ┌─────────────────┐                                       │
│  │ 2FA_ON?  │  │ error: invalid │                                       │
│  └────┬─────┘  └─────────────────┘                                       │
│  yes/ \no                                                      │
│   /     \                                                             │
│  ▼      ▼                                                             │
│ ┌──────────┐  ┌─────────────────────────┐                               │
│ │ PENDING  │  │ JWT + done (sem 2FA)    │                               │
│ │ _2FA     │  └─────────────────────────┘                               │
│ └────┬─────┘                                                            │
│      │ POST /verify-2fa (type: totp, code: xxx)                          │
│      ▼                                                                  │
│ ┌────────────────────┐                                                  │
│ │ TOTP_VALID?        │                                                  │
│ └─────────┬──────────┘                                                  │
│     yes/   \no                                                         │
│      /      \                                                          │
│     ▼       ▼                                                          │
│ ┌────────┐  ┌────────────────────┐                                      │
│ │done+JWT│  │ attempts < 3?     │                                      │
│ └────────┘  └─────────┬──────────┘                                    │
│                        yes/ \no                                         │
│                         /   \                                           │
│                        ▼     ▼                                          │
│               ┌──────────┐  ┌────────────────────┐                      │
│               │error+tries│  │ REQUIRES_BACKUP    │                      │
│               └──────────┘  └─────────┬──────────┘                      │
│                                       │                                   │
│                                       │ POST /verify-2fa (type: backup)  │
│                                       ▼                                   │
│                               ┌─────────────────┐                        │
│                               │ BACKUP_VALID?    │                        │
│                               └────────┬────────┘                        │
│                                  yes/ \no                                │
│                                   /    \                                 │
│                                  ▼      ▼                               │
│                           ┌─────────┐  ┌─────────────────┐              │
│                           │ done+JWT│  │ error: backup   │              │
│                           └─────────┘  │ already used   │              │
│                                         └─────────────────┘              │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Segurança

### 10.1 Ameaças Mitigadas

| Ameaça | Mitigação |
|---|---|
| Senha vazada | TOTP + backup code como barreira adicional |
| Brute force TOTP | Rate limiting no Kong (20 req/min no `/login`) + 3 tentativas máx |
| Backup code reuse | Hash marcado como `[USED]` após uso, não aceita reuso |
| Offline attack | TOTP = tempo-válido, impossível offline em escala |
| Segredo TOTP no banco | AES-256-GCM com chave derivada do JWT_SECRET |
| Backup codes no banco | bcrypt (mesma robustez de senhas) |
| Enumeration | Anti-enumeração: não revela se TOTP está ativo ou não via timing |

### 10.2 NÃO Mitigado (escopo)

| Risco | Status |
|---|---|
| SIM swap | Mitigado por TOTP (não SMS) mas não 100% contra SIM swap sofisticado |
| Phishing | Escopo futuro (WebAuthn como upgrade) |
| Device theft | Usuário responsável por proteger o dispositivo |

---

## 11. Testes

### 11.1 Casos de teste

```typescript
// totp.test.ts
describe('generateTOTPSecret', () => {
  test('gera segredo base32 válido');
  test('gera URL otpauth correta');
});

describe('encrypt/decryptTOTPSecret', () => {
  test('criptografa e descriptografa corretamente');
  test('mesmo secret = ciphertext diferente (IV random)');
  test('throw em formato inválido');
});

describe('verifyTOTP', () => {
  test('aceita código válido');
  test('rejeita código inválido');
  test('rejeita código expirado');
  test('throw em secret corrompido');
});

// backup-codes.test.ts
describe('generateBackupCodes', () => {
  test('gera exatamente 10 códigos');
  test('cada código tem 8 caracteres válidos');
  test('nenhum código se repete');
  test('hashes são bcrypt válidos');
});

describe('verifyBackupCode', () => {
  test('aceita código válido');
  test('rejeita código inválido');
  test('rejeita código já usado');
  test('case-insensitive');
});

describe('markBackupCodeUsed', () => {
  test('marca código específico como USED');
  test('outros códigos permanecem válidos');
});
```

---

## 12. Ordem de Implementação

```
FASE 1 — Foundation (2-3h)
├── db/migrations/0003_totp_2fa.sql
├── Dependências: npm i bcryptjs otplib qrcode
├── src/lib/totp.ts
├── src/lib/backup-codes.ts
└── Testes unitários (totp + backup-codes)

FASE 2 — Gateway Routes (2h)
├── src/gateway/routes/auth.ts (POST /verify-2fa)
├── src/gateway/routes/security.ts (enable/disable/status)
├── src/adapters/pg/user-repository.ts (novos métodos)
└── Testes de integração (curl + gateway vivo)

FASE 3 — CLI (2h)
├── src/cli/commands/auth.ts (fluxo 2FA adaptado)
├── src/cli/commands/security.ts
├── src/lib/gateway-client.ts (novas chamadas)
└── Teste end-to-end (register → enable-2fa → login → logout)

FASE 4 — Hardening (1h)
├── Rate limiting específico pra /verify-2fa (via Kong)
├── Cleanup de pending sessions expiradas (CRON ou gateway startup)
└── Documentação no README
```

---

## 13. Métricas de Sucesso

- [ ] `bun test` → todos os testes passando
- [ ] `bunx tsc --noEmit` → verde
- [ ] Login com 2FA ativo: 3 tentativas TOTP → fallback backup → sucesso
- [ ] Login com 2FA inativo: direto (sem pedir código)
- [ ] Backup code usado: marcado como USADO, não reutilizável
- [ ] Tentativas esgotadas: mensagem clara, não bloqueia permanentemente
- [ ] CLI exibe QR code legível no terminal
- [ ] Security commands (enable/disable/status) funcionando
- [ ] Smoke test end-to-end: register → enable-2fa → login (com TOTP) → whoami → logout

---

## 14. Glossário

| Termo | Definição |
|---|---|
| **TOTP** | Time-based One-Time Password — código de 6 dígitos, muda a cada 30s |
| **2FA** | Two-Factor Authentication — exige 2 fatores (senha + código) |
| **Backup Code** | Código estático de 8 chars, uso único, fallback quando TOTP falha |
| **AES-256-GCM** | Algoritmo de criptografia simétrica autenticada |
| **bcrypt** | Função de hash para senhas (mesma usada no argon2id) |
| **otplib** | Biblioteca TypeScript para geração/verificação TOTP (RFC 6238) |
| **pending_2fa** | Flag na auth_session indicando que JWT ainda não foi emitido |
| **JWT_SECRET** | Segredo compartilhado usado pra assinar JWTs e criptografar TOTP secrets |
