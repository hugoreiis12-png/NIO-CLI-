-- 0007 — Trilha de auth persistente (ADR 0012 · ex-SP-1).
--
-- Registro append-only de todo evento de auth (login OK/falho, 2FA, mudanças de
-- 2FA, logout). Complementa o stderr (real-time) com histórico consultável.
-- `login_ip_events` (0006) segue como rollup barato pro `nio security status`.
--
-- LGPD: guarda usuário TENTADO + IP (dado pessoal). Base legal = segurança;
-- retenção 180 d (gateway apaga); acesso = quem tem o banco.
--
-- Reversão: DROP TABLE IF EXISTS auth_events;

CREATE TABLE IF NOT EXISTS auth_events (
    id       BIGSERIAL PRIMARY KEY,
    at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event    TEXT   NOT NULL,   -- password_ok|password_fail|2fa_sent|2fa_ok|2fa_fail|2fa_expired|2fa_enabled|2fa_disabled|logout
    name     TEXT,              -- usuário tentado (mesmo inexistente) — sinal de spray/enumeração; cap na app
    user_id  BIGINT REFERENCES user_cli(id) ON DELETE SET NULL,  -- a trilha sobrevive ao usuário apagado
    ip       INET,
    trace_id TEXT,              -- correlaciona com a linha do stderr
    detail   JSONB
);

CREATE INDEX IF NOT EXISTS idx_auth_events_name ON auth_events(name, at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_ip   ON auth_events(ip, at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, at DESC);

COMMENT ON TABLE auth_events IS
    'Trilha auditável de auth (append-only). Retenção 180 d (gateway). Ver ADR 0012.';
