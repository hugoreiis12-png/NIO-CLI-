/**
 * Conexão com o PostgreSQL dedicado (`nio_cli`) — fonte da verdade do domínio v2.
 *
 * Um único `Pool` (singleton) para todo o processo. Os repositórios
 * (`adapters/pg/*-repository.ts`) recebem/usam este pool; ninguém cria conexão
 * por conta própria. Node-first via driver `pg` (ver CLAUDE.md — não usar Bun.sql).
 *
 * Config exclusivamente por ambiente:
 *  - `NIO_DATABASE_URL`      (obrigatória) — `postgres://user:pass@host:5432/nio_cli`
 *  - `NIO_DATABASE_SSL`      (opcional)    — `true`/`1` liga TLS **com verificação de cert**
 *  - `NIO_DATABASE_CA`       (opcional)    — path pra um PEM de CA privada (provedores gerenciados)
 *  - `NIO_DATABASE_SSL_INSECURE` (opcional)— `1` desliga a verificação de cert (MITM!) — só último recurso
 *
 * Nenhum segredo é lido de arquivo nem hardcoded. Se a URL faltar, falha explícito
 * na primeira necessidade de conexão — nunca cai num destino default silencioso.
 */
import { readFileSync } from 'node:fs';
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

/** Um flag env vale `true`/`1` (case-insensitive). */
function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** Opção `ssl` do `pg.Pool` a partir do ambiente. Pura o suficiente pra testar. */
export type PgSslOption = boolean | { rejectUnauthorized: boolean; ca?: string };

/**
 * TLS só quando explicitamente ligado (`NIO_DATABASE_SSL`). Quando ligado, o
 * certificado do servidor **é verificado** (`rejectUnauthorized: true`) — a versão
 * antiga aceitava qualquer cert, o que permitia MITM justamente no cenário
 * gerenciado/nuvem. `NIO_DATABASE_CA` aponta um PEM de CA privada; só
 * `NIO_DATABASE_SSL_INSECURE=1` desliga a verificação, e isso grita no log.
 */
export function readSslOption(): PgSslOption | undefined {
  if (!envFlag('NIO_DATABASE_SSL')) return undefined;

  if (envFlag('NIO_DATABASE_SSL_INSECURE')) {
    console.error(
      '[pg] AVISO: NIO_DATABASE_SSL_INSECURE=1 — TLS sem verificação de certificado. ' +
        'A conexão com o banco fica vulnerável a MITM. Use NIO_DATABASE_CA em vez disso.',
    );
    return { rejectUnauthorized: false };
  }

  const caPath = process.env.NIO_DATABASE_CA?.trim();
  if (caPath) {
    try {
      return { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') };
    } catch (err) {
      throw new Error(
        `NIO_DATABASE_CA não pôde ser lido ("${caPath}"): ${(err as Error).message}`,
      );
    }
  }
  return { rejectUnauthorized: true };
}

let pool: Pool | null = null;

/**
 * Retorna o `Pool` do processo, criando-o na primeira chamada (lazy).
 * Idempotente: chamadas seguintes devolvem o mesmo pool.
 */
export function getPool(): Pool {
  if (pool) return pool;

  // Marca (sem custo de import) pra que o shutdown do CLI saiba que precisa
  // fechar o pool — senão o socket ocioso segura o event loop por
  // `idleTimeoutMillis` (30s) e comandos como `nio ai`/`nio sessions` só
  // devolvem o prompt 30s depois de terminar. Ver `closePoolIfOpen`.
  (globalThis as Record<string, unknown>).__nioPgPoolOpen = true;

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `true` se `s` tem forma de UUID. Repositórios com PK `uuid` usam isto pra tratar
 * um id malformado como "não encontrado" em vez de deixar o pg lançar `22P02`.
 */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
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
  (globalThis as Record<string, unknown>).__nioPgPoolOpen = false;
  await p.end();
}
