#!/bin/bash
# Complete setup script for NIO test environment
# Usage: bash scripts/setup-test-env.sh [--clean]
#
# Actions:
# 1. Generate .env.test with secrets
# 2. Start Postgres (docker)
# 3. Run migrations
# 4. Seed test data
# 5. Validate environment
#
# Exit codes:
# 0 = success
# 1 = error (already printed)
# 2 = user cancelled

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CLEAN_MODE="${1:---}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}→${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
error() { echo -e "${RED}✗${NC}  $*"; }

# Check prerequisites
check_prerequisites() {
  log "Checking prerequisites..."

  if ! command -v bun &> /dev/null; then
    error "bun is not installed. Install from https://bun.sh"
    exit 1
  fi

  if ! command -v docker &> /dev/null; then
    error "docker is not installed"
    exit 1
  fi

  if ! command -v psql &> /dev/null; then
    warn "psql not found (will try to connect via docker, may be slower)"
  fi

  if ! command -v openssl &> /dev/null; then
    error "openssl is not installed"
    exit 1
  fi
}

# Clean mode: remove existing setup
clean_env() {
  log "Cleaning up existing test environment..."
  docker compose -f "$PROJECT_ROOT/docker/docker-compose.test.yml" down -v 2>/dev/null || true
  rm -f "$PROJECT_ROOT/.env.test"
  echo "✓ Cleaned"
}

# Generate secrets
generate_secrets() {
  log "Generating secrets..."

  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" 2>/dev/null)
  if [ -z "$JWT_SECRET" ]; then
    error "Failed to generate JWT_SECRET"
    exit 1
  fi

  NIO_PEPPERS="1:$(openssl rand -base64 32 | tr -d '\n' | cut -c1-32)"
  if [ -z "$NIO_PEPPERS" ]; then
    error "Failed to generate NIO_PEPPERS"
    exit 1
  fi

  echo "✓ Secrets generated"
  echo "  JWT_SECRET: ${JWT_SECRET:0:20}..."
  echo "  NIO_PEPPERS: ${NIO_PEPPERS:0:20}..."
}

# Create .env.test
create_env_test() {
  log "Creating .env.test..."

  cat > "$PROJECT_ROOT/.env.test" <<EOF
# NIO Test Environment (auto-generated)
NODE_ENV=test

# Database
NIO_DATABASE_URL=postgres://nio_cli_user:test@localhost:5432/nio_cli_test
NIO_GATEWAY_DATABASE_URL=postgres://nio_gw_user:test@localhost:5432/nio_cli_test
NIO_DATABASE_SSL=false

# Secrets (generated on $(date))
JWT_SECRET=$JWT_SECRET
NIO_PEPPERS=$NIO_PEPPERS

# Gateway
NIO_GATEWAY_HOST=127.0.0.1

# WhatsApp (mock mode)
WHATSAPP_ENDPOINT_URL=http://127.0.0.1:3001/send
WHATSAPP_TOKEN=test-token

# Debug (uncomment to enable)
# NIO_DEBUG=1
EOF

  echo "✓ .env.test created"
}

# Start Postgres
start_postgres() {
  log "Starting Postgres (docker)..."

  # Stop if already running
  docker compose -f "$PROJECT_ROOT/docker/docker-compose.test.yml" down 2>/dev/null || true

  # Start
  docker compose -f "$PROJECT_ROOT/docker/docker-compose.test.yml" up -d postgres

  # Wait for readiness
  local max_attempts=30
  local attempt=0
  while [ $attempt -lt $max_attempts ]; do
    if docker compose -f "$PROJECT_ROOT/docker/docker-compose.test.yml" exec -T postgres pg_isready -U postgres &>/dev/null; then
      echo "✓ Postgres is ready"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  error "Postgres failed to start (timeout after ${max_attempts}s)"
  exit 1
}

# Run migrations
run_migrations() {
  log "Running migrations..."

  export $(cat "$PROJECT_ROOT/.env.test" | xargs)
  cd "$PROJECT_ROOT"

  if bun run db:migrate; then
    echo "✓ Migrations applied"
  else
    error "Failed to run migrations"
    exit 1
  fi
}

# Seed test data
seed_data() {
  log "Seeding test data..."

  export $(cat "$PROJECT_ROOT/.env.test" | xargs)

  if bash "$SCRIPT_DIR/seed-test-db.sh"; then
    echo "✓ Test data seeded"
  else
    error "Failed to seed test data"
    exit 1
  fi
}

# Validate environment
validate_env() {
  log "Validating environment..."

  export $(cat "$PROJECT_ROOT/.env.test" | xargs)
  cd "$PROJECT_ROOT"

  if bun run scripts/validate-test-env.ts; then
    echo "✓ Environment validated"
    return 0
  else
    error "Environment validation failed"
    exit 1
  fi
}

# Print next steps
print_summary() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✨ Test environment setup complete!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Next steps:"
  echo ""
  echo "  1. Start gateway (in another terminal):"
  echo "     export \$(cat .env.test | xargs) && bun run dev:gateway"
  echo ""
  echo "  2. Start WhatsApp mock (in another terminal):"
  echo "     export WHATSAPP_PORT=3001 && bun run dev:whatsapp-echo"
  echo ""
  echo "  3. Run tests:"
  echo "     export \$(cat .env.test | xargs) && bun test"
  echo ""
  echo "  4. Or run CLI in dev mode:"
  echo "     export \$(cat .env.test | xargs) && bun run dev:cli login"
  echo ""
  echo "Environment details:"
  echo "  Database: postgres://localhost:5432/nio_cli_test"
  echo "  Gateway:  http://127.0.0.1:3000"
  echo "  Config:   .env.test (gitignored)"
  echo ""
  echo "To cleanup later:"
  echo "  docker compose -f docker/docker-compose.test.yml down -v"
  echo ""
}

# Main
main() {
  check_prerequisites

  if [ "$CLEAN_MODE" = "--clean" ]; then
    clean_env
  fi

  if [ -f "$PROJECT_ROOT/.env.test" ]; then
    warn ".env.test already exists"
    read -p "Overwrite? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      warn "Aborted"
      exit 2
    fi
  fi

  generate_secrets
  create_env_test
  start_postgres
  run_migrations
  seed_data
  validate_env
  print_summary
}

# Run
main
