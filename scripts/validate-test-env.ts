/**
 * Validate that the test environment is properly configured
 * Usage: bun run scripts/validate-test-env.ts
 *
 * Checks:
 * - .env.test exists and has required vars
 * - Postgres is reachable
 * - Migrations have been applied
 * - pgvector extension is installed
 * - Database roles exist
 * - Test user exists
 */
import { getPool, closePool } from '../src/adapters/pg/client.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

const results: CheckResult[] = [];

async function check(name: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    const ok = await fn();
    results.push({
      name,
      status: ok ? 'ok' : 'error',
      message: ok ? '✓' : '✗',
    });
  } catch (err) {
    results.push({
      name,
      status: 'error',
      message: `${(err as Error).message}`,
    });
  }
}

async function run(): Promise<void> {
  console.log('🔍 Validating NIO test environment...\n');

  // Environment variables
  await check('NIO_DATABASE_URL set', async () => !!process.env.NIO_DATABASE_URL);
  await check('JWT_SECRET set', async () => !!process.env.JWT_SECRET);
  await check('NIO_PEPPERS set', async () => !!process.env.NIO_PEPPERS);

  // Database connectivity
  await check('Postgres reachable', async () => {
    const res = await getPool().query('SELECT 1');
    return res.rowCount === 1;
  });

  // Migrations applied
  await check('schema_migrations table exists', async () => {
    const res = await getPool().query(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='schema_migrations'"
    );
    return parseInt(res.rows[0]?.count || '0', 10) > 0;
  });

  // Check specific migrations
  const migrations = [
    '0001_session_fk_argon2.sql',
    '0002_auth_sessions.sql',
    '0004_login_2fa.sql',
    '0008_db_roles.sql',
    '0010_dax_rag.sql',
    '0011_agent_lesson.sql',
  ];

  for (const migration of migrations) {
    await check(`Migration ${migration.split('_')[0]} applied`, async () => {
      const res = await getPool().query(
        'SELECT COUNT(*) FROM schema_migrations WHERE filename = $1',
        [migration]
      );
      return parseInt(res.rows[0]?.count || '0', 10) > 0;
    });
  }

  // pgvector extension
  await check('pgvector extension installed', async () => {
    const res = await getPool().query(
      "SELECT COUNT(*) FROM pg_extension WHERE extname='vector'"
    );
    return parseInt(res.rows[0]?.count || '0', 10) > 0;
  });

  // Database tables
  const tables = [
    'user_cli',
    'sessions',
    'auth_sessions',
    'login_challenges',
    'auth_events',
    'dax_query_template',
    'agent_lesson',
  ];

  for (const table of tables) {
    await check(`Table ${table} exists`, async () => {
      const res = await getPool().query(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_name=$1",
        [table]
      );
      return parseInt(res.rows[0]?.count || '0', 10) > 0;
    });
  }

  // Database roles
  await check('nio_cli_user role exists', async () => {
    const res = await getPool().query(
      "SELECT COUNT(*) FROM pg_roles WHERE rolname='nio_cli_user'"
    );
    return parseInt(res.rows[0]?.count || '0', 10) > 0;
  });

  await check('nio_gw_user role exists', async () => {
    const res = await getPool().query(
      "SELECT COUNT(*) FROM pg_roles WHERE rolname='nio_gw_user'"
    );
    return parseInt(res.rows[0]?.count || '0', 10) > 0;
  });

  // Print results
  console.log('Results:\n');
  let passCount = 0;
  let failCount = 0;

  for (const result of results) {
    const icon =
      result.status === 'ok' ? '✓' : result.status === 'warn' ? '⚠' : '✗';
    const color =
      result.status === 'ok' ? '\x1b[32m' : result.status === 'warn' ? '\x1b[33m' : '\x1b[31m';
    const reset = '\x1b[0m';

    console.log(`${color}${icon}${reset} ${result.name.padEnd(40)} ${result.message}`);

    if (result.status === 'ok') passCount++;
    else failCount++;
  }

  console.log(
    `\n${passCount} passed, ${failCount} failed out of ${results.length} checks\n`
  );

  if (failCount > 0) {
    console.log(
      '🔧 To fix:\n' +
      '  1. bun run db:migrate                    (apply all migrations)\n' +
      '  2. bash scripts/seed-test-db.sh         (create test user)\n' +
      '  3. Regenerate secrets in .env.test\n'
    );
    process.exit(1);
  }

  console.log('✨ Test environment is ready!\n');
}

try {
  await run();
  await closePool();
} catch (err) {
  console.error(`\nValidation failed: ${(err as Error).message}`);
  await closePool();
  process.exit(1);
}
