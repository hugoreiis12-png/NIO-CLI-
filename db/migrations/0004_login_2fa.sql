-- Migration 0004 — 2º fator no login (SMS OTP + códigos de backup).
-- Aplicar no banco nio_cli JÁ CRIADO. Adiciona 2 colunas em user_cli e 1 tabela
-- nova (login_challenges) — seguro com dados existentes (colunas nullable, sem
-- default destrutivo). Ver docs/specs/auth/0004-login-2fa-sms-otp.md e ADR 0006.
--
-- Motivo: user_cli.auth_2 já existia mas nada a usava. Sem Twilio (abandonado),
-- o estado do OTP (geração, TTL, tentativas) passa a ser nosso — login_challenges.
-- Códigos de backup satisfazem a exigência NIST/ANPD (spec 0003) de não trancar
-- o usuário fora quando o SMS não chega.
--
-- Reversão:
--   DROP TABLE IF EXISTS login_challenges;
--   ALTER TABLE user_cli DROP COLUMN IF EXISTS phone;
--   ALTER TABLE user_cli DROP COLUMN IF EXISTS backup_codes;

BEGIN;

ALTER TABLE user_cli
  ADD COLUMN IF NOT EXISTS phone TEXT;          -- E.164; NULL = 2FA desativado
ALTER TABLE user_cli
  ADD COLUMN IF NOT EXISTS backup_codes TEXT;   -- 10 hashes argon2id juntos por '|'; entrada usada vira '[USED]'

COMMENT ON COLUMN user_cli.phone IS 'Número E.164 pro SMS do 2º fator. NULL = auth_2 desativado.';
COMMENT ON COLUMN user_cli.backup_codes IS 'Hashes argon2id dos 10 códigos de backup (uso único), separados por | ; entrada usada = [USED]. NULL = sem 2FA.';

CREATE TABLE IF NOT EXISTS login_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('login', 'enable_2fa')),
    code_hash TEXT NOT NULL,       -- HMAC-SHA256(código, JWT_SECRET). NUNCA o código puro.
    channel TEXT NOT NULL CHECK (channel IN ('sms')),
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,       -- NULL = ativo; preenchido = já usado (uso único)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_challenges_user ON login_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_login_challenges_expires ON login_challenges(expires_at);

COMMENT ON TABLE login_challenges IS 'Desafio de OTP em andamento (2º fator). Uso único (consumed_at), TTL curto (expires_at), 3 tentativas (attempts). code_hash = HMAC, nunca o código puro.';

COMMIT;
