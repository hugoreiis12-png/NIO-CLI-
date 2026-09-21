#!/usr/bin/env bash
#
# Certificado de servidor pro Kong (edge TLS :8443) emitido pela MESMA CA
# interna do Postgres (db-tls/ca.crt) — decisão registrada (reutilizar a CA
# existente, sem CA nova). Só `openssl` — espelha scripts/db-tls-setup.sh.
#
#   CA_DIR=db-tls bash scripts/kong-tls-setup.sh server 192.168.0.160
#   KONG_TLS_DIR=/seguro/kong-tls bash scripts/kong-tls-setup.sh server kong.local 192.168.0.160
#
# Saída (KONG_TLS_DIR, default ./kong-tls — gitignored, NUNCA commitar a key):
#   kong.crt  → público. Vai pro Portainer como KONG_SSL_CERT (conteúdo PEM).
#   kong.key  → SEGREDO. Vai pro Portainer como KONG_SSL_CERT_KEY (conteúdo PEM).
#               Cofre do time + backup offline, como o JWT_SECRET.
#
# O SAN precisa cobrir EXATAMENTE como os clientes alcançam o Kong
# (IP da LAN e/ou DNS). Sem isso o fetch da CLI falha com
# ERR_TLS_CERT_ALTNAME_INVALID — mesmo com a CA instalada.
set -euo pipefail

OUT="${KONG_TLS_DIR:-kong-tls}"
CA_DIR="${DB_TLS_DIR:-db-tls}"
KONG_DAYS="${KONG_DAYS:-825}"   # ~27 meses (mesmo teto do cert do Postgres)

die() { echo "erro: $*" >&2; exit 1; }
command -v openssl >/dev/null || die "openssl não encontrado no PATH."
[ -f "$CA_DIR/ca.key" ] || die "CA não encontrada em $CA_DIR/ca.key — crie com \`bash scripts/db-tls-setup.sh init\` primeiro."
[ -f "$CA_DIR/ca.crt" ] || die "CA pública ausente em $CA_DIR/ca.crt."

[ "$#" -ge 1 ] || die "informe ao menos um hostname/IP (como os clientes alcançam o Kong). Ex.: $0 server 192.168.0.160"

if [ -f "$OUT/kong.key" ] && [ "${KONG_TLS_FORCE:-}" != "1" ]; then
  die "$OUT/kong.key já existe — renovação exige KONG_TLS_FORCE=1 (o par atual segue válido até vencer)."
fi
mkdir -p "$OUT"

# SAN: cada arg vira DNS:<x> ou IP:<x> (mesma heurística IPv4 do db-tls-setup.sh).
san="" ip_re='^[0-9]+(\.[0-9]+){3}$'
for host in "$@"; do
  if [[ "$host" =~ $ip_re ]]; then san+="IP:$host,"; else san+="DNS:$host,"; fi
done
san="${san%,}"

openssl genrsa -out "$OUT/kong.key" 2048
chmod 600 "$OUT/kong.key"
openssl req -new -key "$OUT/kong.key" -subj "/O=NIO/CN=$1" -out "$OUT/kong.csr"
openssl x509 -req -in "$OUT/kong.csr" -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" \
  -CAcreateserial -days "$KONG_DAYS" -sha256 \
  -extfile <(printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san") \
  -out "$OUT/kong.crt"
rm -f "$OUT/kong.csr"

cat <<EOF
✓ Certificado do Kong emitido (SAN: $san), validade ${KONG_DAYS} dias.

  No Portainer (stack nio_cli277 → Environment variables), defina:
    KONG_PROXY_LISTEN=0.0.0.0:8000, 0.0.0.0:8443 ssl
    KONG_SSL_CERT=<conteúdo de $OUT/kong.crt>
    KONG_SSL_CERT_KEY=<conteúdo de $OUT/kong.key>
  (valores ficam no Portainer, NUNCA no git — mesmo nível de sigilo do JWT_SECRET)
  Depois: redeploy ("Pull and redeploy").

  Nos clientes (cada máquina que roda \`nio\`):
    1. Instale $CA_DIR/ca.crt no trust store do SO, ou
       NODE_EXTRA_CA_CERTS=/caminho/para/ca.crt
    2. NIO_GATEWAY_URL=https://<um-dos-SANs-acima>:8443
  Validação: curl https://<host>:8443/health (sem -k) → {"ok":true,...}

  Renovação: rode de novo com KONG_TLS_FORCE=1 antes de vencer e troque as
  duas vars no Portainer. Expiração atual: confira com
    openssl x509 -in $OUT/kong.crt -noout -dates
EOF
