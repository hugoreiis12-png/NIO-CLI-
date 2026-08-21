/**
 * Conexão com o PostgreSQL dedicado (`nio_cli`) — fonte da verdade do domínio v2.
 *
 * Um único `Pool` (singleton) para todo o processo. Os repositórios
 * (`adapters/pg/*-repository.ts`) recebem/usam este pool; ninguém cria conexão
 * por conta própria. Node-first via driver `pg` (ver CLAUDE.md — não usar Bun.sql).
 *
 * Config exclusivamente por ambiente:
 *  - `NIO_DATABASE_URL`  (obrigatória) — `postgres://user:pass@host:5432/nio_cli`
 *  - `NIO_DATABASE_SSL`  (opcional)    — `true`/`1` liga TLS (bancos gerenciados)
 *
 * Nenhum segredo é lido de arquivo nem hardcoded. Se a URL faltar, falha explícito
 * na primeira necessidade de conexão — nunca cai num destino default silencioso.
 */
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/** Lê e valida `NIO_DATABASE_URL`. Throw com mensagem acionável se ausente/ inválida. */
function readDatabaseUrl(): string {
  const url = process.env.NIO_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'NIO_DATABASE_URL não definida. Configure a conexão do Postgres, ex.: ' +
        'NIO_DATABASE_URL="postgres://user:pass@host:5432/nio_cli".',
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      `NIO_DATABASE_URL inválida: esperado "postgres://..." e veio "${url.slice(0, 16)}…".`,
    );
  }
  return url;
}

/** TLS só quando explicitamente ligado — default é conexão simples (dev local). */
function readSslOption(): { rejectUnauthorized: boolean } | undefined {
  const flag = process.env.NIO_DATABASE_SSL?.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return { rejectUnauthorized: false };
  return undefined;
}

let pool: Pool | null = null;

/**
 * Retorna o `Pool` do processo, criando-o na primeira chamada (lazy).
 * Idempotente: chamadas seguintes devolvem o mesmo pool.
 */
export function getPool(): Pool {
  if (pool) return pool;

  pool = new Pool({
    connectionString: readDatabaseUrl(),
    ssl: readSslOption(),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Erro em client ocioso não deve derrubar o processo — logamos e seguimos; o
  // pool descarta o client quebrado e abre outro na próxima query.
  pool.on('error', (err) => {
    console.error('[pg] erro em client ocioso do pool:', err.message);
  });

  return pool;
}

/**
 * Executa uma query parametrizada no pool. Sempre use `params` ($1, $2, …) —
 * nunca interpole valores na string SQL (injeção).
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params ? [...params] : undefined);
}

/**
 * Roda `fn` com um client dedicado do pool dentro de uma transação
 * (`BEGIN`/`COMMIT`, com `ROLLBACK` em erro). Use quando várias escritas precisam
 * ser atômicas (ex.: criar sessão + arquivar as outras ativas do usuário).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Healthcheck: `SELECT 1`. Retorna `true` se o banco respondeu. Não lança —
 * transforma qualquer falha (URL ausente, banco fora, credencial ruim) em `false`,
 * para o chamador decidir a mensagem de UI.
 */
export async function ping(): Promise<boolean> {
  try {
    const res = await query<{ ok: number }>('SELECT 1 AS ok');
    return res.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

/** Encerra o pool (fecha todas as conexões). Chamar no shutdown do processo. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}
