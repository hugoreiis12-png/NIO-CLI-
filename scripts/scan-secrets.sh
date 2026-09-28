#!/usr/bin/env bash
# Varre os arquivos versionados atrás de segredo literal. Gate do CI e comando local.
# Uso: bash scripts/scan-secrets.sh   (sai 1 se achar algo)
#
# Escape auditável: a linha com `nio-allow-secret` num comentário é ignorada —
# use para valor efêmero de teste, e diga no comentário por que é seguro.
set -uo pipefail

# Lockfile/binário carregam hash de integridade; teste carrega fixture de hash;
# SECURITY.md carrega exemplos do que NÃO fazer. Nada disso é segredo vivo.
EXCLUDE='^(bun\.lock|package-lock\.json|\.github/SECURITY\.md|.*\.(test|spec)\.tsx?|.*\.(svg|png|jpg|ico|lock))$'

NAMED='(AZURE_CLIENT_SECRET|JWT_SECRET|NIO_GATEWAY_TOKEN|DATABASE_PASSWORD|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|OPENAI_API_KEY|OTP_HMAC_SECRET|NIO_PEPPER)'
NAMED_LITERAL="${NAMED}[\"']?[[:space:]]*[:=][[:space:]]*[\"']?[A-Za-z0-9_/+.~-]{8,}"

# 64+ hex = randomBytes(32).hex, o formato dos nossos tokens. SHA-1 de commit
# (40) e digest de imagem ficam de fora de propósito: são públicos e onipresentes.
HEX_TOKEN='\b[a-f0-9]{64,}\b'

failed=0
report() { echo "❌ $1"; printf '%s\n' "$2" | head -10; failed=1; }

files=$(git ls-files | grep -Ev "$EXCLUDE")
# `$`=env, `<`=placeholder, `process.env`=leitura — nenhum é valor literal.
drop() { grep -v 'nio-allow-secret' | grep -v '\$' | grep -v '<' | grep -v 'process\.env'; }

hits=$(printf '%s\n' "$files" | xargs grep -HnE "$NAMED_LITERAL" 2>/dev/null | drop || true)
[ -n "$hits" ] && report "Segredo nomeado com valor literal:" "$hits"

hits=$(printf '%s\n' "$files" | xargs grep -HnE "$HEX_TOKEN" 2>/dev/null | grep -v 'sha256:' | drop || true)
[ -n "$hits" ] && report "Token hexadecimal (64+ chars):" "$hits"

if [ $failed -eq 1 ]; then
  echo ""
  echo "🔒 Use \${VAR} do ambiente ou um placeholder. Veja .github/SECURITY.md"
  exit 1
fi

echo "✅ Nenhum segredo literal encontrado."
