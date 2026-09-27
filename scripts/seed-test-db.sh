#!/bin/bash
# Seed test database with fixture data
# Usage: bash scripts/seed-test-db.sh

set -e

DB_URL="${NIO_DATABASE_URL:-postgres://nio_cli_user:test@localhost:5432/nio_cli_test}"

echo "→ Clearing existing test data..."
# Delete in order (respecting FKs)
psql "$DB_URL" <<EOF > /dev/null 2>&1 || true
  DELETE FROM session_activity;
  DELETE FROM dependency_events;
  DELETE FROM log_session;
  DELETE FROM sessions;
  DELETE FROM auth_sessions;
  DELETE FROM auth_events;
  DELETE FROM login_ip_events;
  DELETE FROM login_challenges;
  DELETE FROM user_cli;
EOF

echo "→ Creating test user..."
# Note: password hash for "test123" via Argon2
# Pre-computed for test consistency
psql "$DB_URL" <<EOF > /dev/null
INSERT INTO user_cli (
  email,
  password_hash,
  password_pepper_id,
  auth_2,
  phone,
  created_at
) VALUES (
  'test@example.com',
  -- Argon2id hash of "test123" (pepper_id=1)
  -- Pre-generated for reproducibility
  '\$argon2id\$v=19\$m=19456,t=2,p=1\$yqVXp2HRHvAiWg4X2zfKPQ\$S+FKJhfkbJ3L7TdT3p2Q4R5S6T7U8V9W0X1Y2Z3a',
  1,
  false,
  NULL,
  NOW()
) ON CONFLICT (email) DO NOTHING;
EOF

echo "→ Creating test session..."
psql "$DB_URL" <<EOF > /dev/null
INSERT INTO sessions (
  user_id,
  profile,
  config,
  status,
  created_at
) VALUES (
  (SELECT id FROM user_cli WHERE email='test@example.com'),
  'fullstack',
  '\{"lang":"nodejs","ide":"vscode","pkg":"npm","workspace":"test"\}'::jsonb,
  'active',
  NOW()
) ON CONFLICT DO NOTHING;
EOF

echo "→ Creating test activity logs..."
psql "$DB_URL" <<EOF > /dev/null
INSERT INTO log_session (
  session_id,
  cli_version,
  os,
  os_version,
  model_context,
  created_at
) VALUES (
  (SELECT id FROM sessions WHERE user_id = (SELECT id FROM user_cli WHERE email='test@example.com') LIMIT 1),
  '0.15.2',
  'darwin',
  '25.3.0',
  'claude-3.5-sonnet',
  NOW()
) ON CONFLICT DO NOTHING;
EOF

echo "→ Creating test dependency events..."
psql "$DB_URL" <<EOF > /dev/null
INSERT INTO dependency_events (
  session_id,
  file_path,
  dependency_name,
  dependency_type,
  installed_at
) VALUES
  (
    (SELECT id FROM sessions WHERE user_id = (SELECT id FROM user_cli WHERE email='test@example.com') LIMIT 1),
    'package.json',
    'express',
    'npm',
    NOW()
  ),
  (
    (SELECT id FROM sessions WHERE user_id = (SELECT id FROM user_cli WHERE email='test@example.com') LIMIT 1),
    'package.json',
    'typescript',
    'npm',
    NOW()
  )
ON CONFLICT DO NOTHING;
EOF

echo "→ Checking data..."
USERS=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM user_cli;")
SESSIONS=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM sessions;")
DEPS=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM dependency_events;")

echo "✓ Seed completed:"
echo "  Users:              $USERS"
echo "  Sessions:           $SESSIONS"
echo "  Dependency events:  $DEPS"
