/**
 * Gate de arquitetura: o grafo de imports ESTÁTICOS do `nio` nunca alcança um
 * binding nativo.
 *
 * Existe porque já quebrou em produção: `cli/commands/auth.ts` importava
 * `MIN_PASSWORD_LENGTH` de `gateway/auth/password.ts`, que carregava
 * `@node-rs/argon2` no topo. Um binding ausente (bug npm/cli#4828 em
 * dependência opcional) derrubava `nio` sem args, `nio --help` e `nio whoami`
 * com "Cannot find native binding" — por causa de um número inteiro.
 *
 * O recorte é o entrypoint do CLI cliente. `gateway/index.ts`, `mcp-server.ts`
 * e o worker PODEM carregar argon2: lá o hashing é a função, não um acidente.
 */
import { test, expect } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Pacotes que trazem `.node` compilado — ausentes, explodem no load, não no uso. */
const BINDINGS_NATIVOS = ['@node-rs/argon2', '@huggingface/transformers'];

/** Entrypoints do CLI cliente: tudo que um `nio <cmd>` pode carregar de cara. */
const ENTRYPOINTS = ['cli.ts', 'cli/program.ts', 'cli/program-lazy.ts'];

/** Só `from '...'` — `await import('...')` é lazy de propósito e não conta. */
function especificadoresEstaticos(arquivo: string): string[] {
  const src = readFileSync(arquivo, 'utf8');
  const semTipo = src.replace(/import\s+type\s+[^;]+;/g, ''); // `import type` é erasado
  return [...semTipo.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

function resolverRelativo(de: string, spec: string): string | null {
  const base = resolve(dirname(de), spec.replace(/\.js$/, ''));
  for (const cand of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      // candidato inexistente: tenta a próxima extensão
    }
  }
  return null;
}

/** Caminho de imports do entrypoint até um dos `alvos`, ou `null` se não alcança. */
function trilhaAteBinding(
  entrypoint: string,
  alvos: readonly string[] = BINDINGS_NATIVOS,
): string[] | null {
  const vistos = new Set([entrypoint]);
  const fila: Array<{ arquivo: string; trilha: string[] }> = [{ arquivo: entrypoint, trilha: [] }];
  while (fila.length > 0) {
    const { arquivo, trilha } = fila.shift()!;
    const atual = [...trilha, relative(SRC, arquivo)];
    for (const spec of especificadoresEstaticos(arquivo)) {
      if (alvos.includes(spec)) return [...atual, spec];
      if (!spec.startsWith('.')) continue;
      const proximo = resolverRelativo(arquivo, spec);
      if (!proximo || vistos.has(proximo)) continue;
      vistos.add(proximo);
      fila.push({ arquivo: proximo, trilha: atual });
    }
  }
  return null;
}

for (const entrypoint of ENTRYPOINTS) {
  test(`${entrypoint} não alcança binding nativo por import estático`, () => {
    const trilha = trilhaAteBinding(join(SRC, entrypoint));
    expect(trilha?.join(' → ') ?? null).toBeNull();
  });
}

test('o gate enxerga uma violação plantada — não passa por walker cego', () => {
  // Sem esta âncora o teste acima passaria por engano se a travessia parasse de
  // resolver imports relativos. Usa um binding fictício alcançável de verdade.
  const alvoPlantado = ['./password-policy.js'];
  expect(trilhaAteBinding(join(SRC, 'gateway/auth/password.ts'), alvoPlantado)).not.toBeNull();
});
