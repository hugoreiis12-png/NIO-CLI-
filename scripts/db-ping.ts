/**
 * Healthcheck manual da conexão com o Postgres `nio_cli`.
 * Uso: `bun run db:ping` (lê NIO_DATABASE_URL do .env na raiz do repo).
 *
 * Em caso de falha, imprime a causa real (código + mensagem do pg) para
 * diagnóstico — diferente do `ping()` do adapter, que nunca lança.
 */
import { getPool, closePool } from '../src/adapters/pg/client.js';

const url = process.env.NIO_DATABASE_URL;

if (!url) {
  console.error(
    '✗ NIO_DATABASE_URL não foi carregada. Confira se o .env está na RAIZ do repo\n' +
      '  (C:\\Users\\JFC\\Desktop\\NIO-CLI\\NIO-CLI\\.env) e tem a linha NIO_DATABASE_URL=...',
  );
  process.exit(1);
}

// Mostra a URL com a senha mascarada, pra confirmar host/porta/db sem vazar segredo.
const masked = url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@');
console.log(`→ Tentando conectar em: ${masked}`);

try {
  const res = await getPool().query<{ ok: number }>('SELECT 1 AS ok');
  if (res.rows[0]?.ok === 1) {
    console.log('✓ Conexão com nio_cli OK (SELECT 1 respondeu).');
    await closePool();
    process.exit(0);
  }
  console.error('✗ Conectou mas o SELECT 1 não retornou o esperado.');
  await closePool();
  process.exit(1);
} catch (err) {
  const e = err as { code?: string; message?: string };
  console.error(`✗ Falha ao conectar. [${e.code ?? 'sem código'}] ${e.message ?? err}`);
  console.error(
    '  Dicas: ECONNREFUSED = Postgres não está rodando / host:porta errados;\n' +
      '  "password authentication failed" = usuário/senha errados;\n' +
      '  "database ... does not exist" = nome do banco errado;\n' +
      '  erro de SSL/TLS = adicione NIO_DATABASE_SSL=true no .env.',
  );
  await closePool();
  process.exit(1);
}
