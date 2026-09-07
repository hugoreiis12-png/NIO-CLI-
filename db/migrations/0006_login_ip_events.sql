-- 0006 — Auditoria de IP de login (ADR 0011, fase 3 · ex-I-2).
--
-- Registra de quais IPs cada usuário logou (só auditoria — NÃO bloqueia).
-- Populada no `/login` / `/verify-2fa` bem-sucedido; visível no `nio security
-- status`. Retenção: o gateway apaga linhas com `last_seen` > 90 dias.
-- `user_cli.ips_using` continua reservada pra um allowlist futuro — não é tocada.
--
-- LGPD: IP é dado pessoal; base legal = segurança (legítimo interesse),
-- retenção definida (90 d), o titular vê os próprios IPs.
--
-- Reversão: DROP TABLE IF EXISTS login_ip_events;

CREATE TABLE IF NOT EXISTS login_ip_events (
    user_id    BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
    ip         INET   NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    count      BIGINT NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, ip)
);

CREATE INDEX IF NOT EXISTS idx_login_ip_events_last_seen ON login_ip_events(last_seen);

COMMENT ON TABLE login_ip_events IS
    'Auditoria: IPs de login por usuário. Só registro, sem enforcement. Retenção 90 d (gateway). Ver ADR 0011.';
