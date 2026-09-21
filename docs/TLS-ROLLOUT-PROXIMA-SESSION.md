# TLS Rollout — Feature para a próxima sessão

> Estado: **planejado e parcialmente implementado (repo), NÃO cortado em prod.**
> Decisão vigente: TLS adiado por ora, com controles compensatórios (ver §5).
> Comece a próxima sessão por este arquivo — dispensa re-mapeamento.

## 1. Decisões fechadas (não reabrir sem motivo novo)

| # | Decisão | Alternativa descartada |
|---|---|---|
| 1 | Fase 1 (PG) antes da Fase 2 (Kong) | Juntas na mesma janela |
| 2 | Reutilizar CA interna existente (`db-tls/`, gitignored) + host/IP `.142` + credenciais atuais | Criar CA nova |
| 3 | Kong termina TLS em `:8443`, opt-in por env, `:8000` segue na transição | TLS em todo lugar de uma vez |
| 4 | Execução server-side via runbook (sem acesso direto desta máquina) | SSH desta estação |
| 5 | Sem mudança de código TS (fetch verifica via trust store do SO / `NODE_EXTRA_CA_CERTS`) | Knob `NIO_GATEWAY_CA` com Agent custom (YAGNI) |

## 2. Estado do repo (branch `feat/kong-edge-tls`, commit `f2bf6af`)

- `docker/docker-compose.deploy.yml`: `KONG_PROXY_LISTEN`/`KONG_SSL_CERT*` via env (default = `:8000`, igual a hoje); publish `:8443` + mount `ca.crt` do gateway **nascem comentados** (só no corte).
- `scripts/kong-tls-setup.sh` (+ `kong:tls` no `package.json`): emite `kong.crt/key` pela CA interna. Modo `100755`. Não testado em Linux ainda (sem bash no Windows) — rodar uma vez antes do corte.
- `docs/arch/KONG-GATEWAY-USO.md` §6.1: procedimento de corte/validação/reversão/expiração.
- Material existente reaproveitado: `db-tls/server.crt` (SAN `IP:192.168.0.142`, até 12/2028), `db-tls/ca.crt` (até 2036). Nada a emitir para a Fase 1.

## 3. Corte Fase 1 — Postgres `.142` (dono da infra, 1 janela)

Pré-requisitos: backup recente confirmado + `ca.key` no cofre do time.

```bash
# No .142: instalar o par já emitido
sudo install -o postgres -g postgres -m 600 server.key /etc/postgresql/17/main/server.key
sudo install -o postgres -g postgres -m 644 server.crt /etc/postgresql/17/main/server.crt
# postgresql.conf: ssl_cert/key_file -> novos paths (ssl já é on, snakeoil hoje)
# pg_hba.conf: hostssl nio_cli all <rede-do-gateway>/x scram-sha-256 ANTES das linhas host (fallback mantido)
sudo pg_ctlcluster 17 main reload
# conferir: SHOW ssl + s_client (issuer precisa ser CN=NIO Internal DB CA)
```

Portainer (stack 106): criar `/etc/nio/db-ca.pem` no host (de `db-tls/ca.crt`) →
descomentar mount + `NIO_DATABASE_CA` no compose → `NIO_DATABASE_SSL=true` →
redeploy → `db:migrate -- --status` 9/9 + `POST /login` real.
Reversão: `NIO_DATABASE_SSL=false` + redeploy, e/ou restaurar `.bak` + reload.

## 4. Corte Fase 2 — Kong `:8443` (outra janela, após Fase 1 estável)

1. `bash scripts/kong-tls-setup.sh server 192.168.0.160` (+ DNS se houver).
2. Portainer: `KONG_PROXY_LISTEN=0.0.0.0:8000, 0.0.0.0:8443 ssl` + `KONG_SSL_CERT*` (PEM) + descomentar publish `:8443` no compose → redeploy.
3. Validar **sem `-k`**: `curl https://192.168.0.160:8443/health` + `s_client` (issuer = CA interna).
4. Clientes: `ca.crt` no trust store + `NIO_GATEWAY_URL=https://192.168.0.160:8443`, máquina a máquina.
Reversão: URL de volta p/ `http://:8000` e/ou remover `ssl` do listener + redeploy.

## 5. Adiamento formal + compensatórios (vigente até revisão)

- Risco aceito: JWT/senha/OTP em claro na LAN + conteúdo do banco em claro no `.142`.
- Compensatórios: (a) `ca.key` no cofre **hoje**; (b) uso local com `nio_cli_user` em vez de `postgres`; (c) senha SSH exposta em chat — **rotacionar** (pendente, dono da infra).
- Revisar em: data a definir com o time. Expiries não pressionam (server 12/2028, CA 2036).

## 6. Critério de pronto (os 4 sinais, em sequência)

1. `s_client` PG mostra issuer `CN=NIO Internal DB CA`.
2. `db:migrate -- --status` 9/9 contra prod.
3. `POST /login` + `GET /health` reais via gateway.
4. `curl https://192.168.0.160:8443/health` sem `-k` verde.

## 7. Proibições

- Nunca `--baseline` em prod como "fix" (só `--status` primeiro).
- Nunca segredo (senha, key, JWT) em chat, compose ou git — só Portainer/cofre.
- Nunca tag `v*` sem decidir o destino do `excelMcp` (perfis) — trilha separada.
