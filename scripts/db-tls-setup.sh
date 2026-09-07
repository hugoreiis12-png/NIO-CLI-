#!/usr/bin/env bash
#
# CA interna + certificado de servidor pro Postgres self-hosted (auditoria H-2).
# Só `openssl` — sem AWS/Cloud SQL/step-ca. Roda uma vez pra criar a CA.
set -euo pipefail

OUT="${DB_TLS_DIR:-db-tls}"
CA_DAYS="${CA_DAYS:-3650}"       # CA: 10 anos
SRV_DAYS="${SRV_DAYS:-825}"      # servidor: ~27 meses (teto que navegadores/libs aceitam)

die() { echo "erro: $*" >&2; exit 1; }
command -v openssl >/dev/null || die "openssl não encontrado no PATH."

cmd_init() {
  mkdir -p "$OUT"
  [ -f "$OUT/ca.key" ] && die "$OUT/ca.key já existe — a CA já foi criada. Apague $OUT/ para recriar."

  openssl genrsa -out "$OUT/ca.key" 4096
  chmod 600 "$OUT/ca.key"
  openssl req -x509 -new -nodes -key "$OUT/ca.key" -sha256 -days "$CA_DAYS" \
    -subj "/O=NIO/CN=NIO Internal DB CA" -out "$OUT/ca.crt"

  echo "✓ CA criada:"
  echo "  $OUT/ca.key   → SEGREDO. Guarde offline / no cofre de senhas do time. NÃO commitar."
  echo "  $OUT/ca.crt   → público. É o NIO_DATABASE_CA."
}

cmd_server() {
  [ "$#" -ge 1 ] || die "informe ao menos um hostname/IP (o que os clientes usam no NIO_DATABASE_URL)."
  [ -f "$OUT/ca.key" ] || die "rode \`$0 init\` primeiro."

  # SAN: cada arg vira DNS:<x> ou IP:<x> (heurística simples de IPv4).
  local san="" ip_re='^[0-9]+(\.[0-9]+){3}$'
  for host in "$@"; do
    if [[ "$host" =~ $ip_re ]]; then san+="IP:$host,"; else san+="DNS:$host,"; fi
  done
  san="${san%,}"

  openssl genrsa -out "$OUT/server.key" 4096
  chmod 600 "$OUT/server.key"
  openssl req -new -key "$OUT/server.key" -subj "/O=NIO/CN=$1" -out "$OUT/server.csr"
  openssl x509 -req -in "$OUT/server.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" \
    -CAcreateserial -days "$SRV_DAYS" -sha256 \
    -extfile <(printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san") \
    -out "$OUT/server.crt"
  rm -f "$OUT/server.csr"

  cat <<EOF
✓ Certificado de servidor emitido (SAN: $san), validade ${SRV_DAYS} dias.

  No host do Postgres — copie e dê permissão ao usuário postgres:
    install -o postgres -g postgres -m 600 $OUT/server.key \$PGDATA/server.key
    install -o postgres -g postgres -m 644 $OUT/server.crt \$PGDATA/server.crt

  postgresql.conf:
    ssl = on
    ssl_cert_file = 'server.crt'
    ssl_key_file  = 'server.key'

  pg_hba.conf (força TLS para o nio_cli):
    hostssl  nio_cli  all  0.0.0.0/0  scram-sha-256

  Reinicie o Postgres. Depois, no lado do NIO (config.env / stack):
    NIO_DATABASE_SSL=true
    NIO_DATABASE_CA=/caminho/para/ca.crt
  E garanta que o host em NIO_DATABASE_URL seja EXATAMENTE um dos nomes/IPs do SAN.
EOF
}

case "${1:-}" in
  init)   shift; cmd_init "$@" ;;
  server) shift; cmd_server "$@" ;;
  *) die "uso: $0 init | server <hostname|ip> [<hostname|ip> ...]" ;;
esac
