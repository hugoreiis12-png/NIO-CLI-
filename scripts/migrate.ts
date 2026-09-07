/**
 * Runner de migração idempotente (auditoria I-3b). Sem dep externa — driver `pg`
 * + uma tabela de controle `schema_migrations`.
 *
 *   bun run db:migrate                aplica as migrações pendentes de db/migrations/
 *   bun run db:migrate --status       lista aplicadas × pendentes e sai
 *   bun run db:migrate --baseline     marca TODAS as pendentes como aplicadas SEM
 *                                     rodar (banco novo, de schema.sql atual)
 *   bun run db:migrate --baseline <f> marca só até <f> (inclusive) — banco antigo
 *                                     que já está num ponto e precisa aplicar o resto
 *
 * Banco NOVO: `psql "$NIO_DATABASE_URL" -f db/schema.sql` → `bun run db:migrate
 *   --baseline` → daí só `bun run db:migrate`.
 * Banco EXISTENTE (ex.: já no 0004, sem tabela de controle):
 *   `bun run db:migrate --baseline 0004_login_2fa.sql` → `bun run db:migrate`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool, withTransaction } from '../src/adapters/pg/client.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 0001_, 0002_, … — prefixo numérico garante a ordem
}

async function ensureTable(): Promise<void> {
  await getPool().query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

async function appliedSet(): Promise<Set<string>> {
  const r = await getPool().query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(r.rows.map((x) => x.filename));
}

async function run(): Promise<void> {
  const mode = process.argv[2];
  await ensureTable();
  const files = migrationFiles();
  const done = await appliedSet();
  const pending = files.filter((f) => !done.has(f));

  if (mode === '--status') {
    for (const f of files) console.log(`${done.has(f) ? '✓' : ' '} ${f}`);
    console.log(`\n${done.size} aplicada(s), ${pending.length} pendente(s).`);
    return;
  }

  if (mode === '--baseline') {
    // `--baseline`         → marca TODAS as pendentes (DB fresco de schema.sql).
    // `--baseline <arquivo>` → marca só até <arquivo> (inclusive) — DB antigo que
    //                          já está num ponto e precisa aplicar o resto.
    const upTo = process.argv[3];
    if (upTo && !files.includes(upTo)) {
      console.error(`arquivo não encontrado em db/migrations/: "${upTo}"`);
      process.exit(2);
    }
    const target = upTo
      ? pending.filter((f) => f <= upTo)
      : pending;
    if (target.length === 0) return console.log('Nada a marcar — tudo já registrado.');
    for (const f of target) {
      await getPool().query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [f],
      );
    }
    return console.log(`Baseline: ${target.length} migração(ões) marcada(s) sem rodar.`);
  }

  if (mode && mode !== '--apply') {
    console.error(`modo desconhecido: "${mode}" (use --status | --baseline | sem args)`);
    process.exit(2);
  }

  if (pending.length === 0) return console.log('Sem migrações pendentes.');
  for (const f of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    process.stdout.write(`→ ${f} … `);
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
    });
    console.log('ok');
  }
  console.log(`\n${pending.length} migração(ões) aplicada(s).`);
}

try {
  await run();
  await closePool();
} catch (err) {
  console.error(`\n✗ migração falhou: ${(err as Error).message}`);
  await closePool();
  process.exit(1);
}
