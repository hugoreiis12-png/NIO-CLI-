/**
 * Confere os nomes de tabela de um DAX contra o inventário real do modelo **antes**
 * de gastar uma request no Fabric.
 *
 * Por que existe: o `nio_fabric_query` executa DAX cru, sem nenhum grounding — o
 * modelo escreve de memória e leva `Cannot find table`, que volta como 400 sem dizer
 * quais tabelas existem. Cada tentativa dessas custa uma das 120 req/min e não ensina
 * nada. Aqui a falha é local, instantânea, e devolve os nomes certos.
 *
 * Puro: sem IO. O chamador traz o inventário.
 */

/** Palavras da linguagem que aparecem antes de `[` mas não são tabela. */
const DAX_KEYWORDS = new Set([
  'evaluate', 'define', 'measure', 'column', 'table', 'var', 'return', 'order', 'by',
  'start', 'at', 'asc', 'desc', 'not', 'in', 'and', 'or',
]);

/** `'Nome Com Espaço'` — em DAX aspas simples só cercam identificador de tabela. */
const QUOTED = /'([^']{1,128})'/g;
/** `Tabela[Coluna]` sem aspas (só vale quando o nome não tem caractere especial). */
const BARE_BEFORE_BRACKET = /(^|[\s(,=<>+\-*/])([A-Za-z_][A-Za-z0-9_]{0,127})\s*\[/g;

/** Normaliza para comparar: sem acento, sem caixa, sem separador. */
function fold(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_.-]+/g, '');
}

/**
 * Nomes declarados no próprio `DEFINE` (`TABLE X =`, `VAR X =`, `COLUMN T[c] =`,
 * `MEASURE T[m] =`). São locais da consulta e **não existem no modelo** — acusá-los
 * bloqueava toda consulta com `DEFINE TABLE`, e a mensagem ainda mandava o agente
 * "corrigir o nome" de algo correto. Visto em produção.
 */

export function locallyDefined(dax: string): Set<string> {
  const nomes = new Set<string>();
  if (!/\bDEFINE\b/i.test(dax)) return nomes;
  for (const m of dax.matchAll(/\b(?:TABLE|VAR|COLUMN|MEASURE)\s+([A-Za-z_][A-Za-z0-9_]{0,127})\s*(?=[[=])/gi)) {
    nomes.add(m[1]!.toLowerCase());
  }
  // `DEFINE X = …` sem a palavra-chave (forma que o modelo escreve às vezes).
  for (const m of dax.matchAll(/\bDEFINE\s+([A-Za-z_][A-Za-z0-9_]{0,127})\s*=/gi)) {
    nomes.add(m[1]!.toLowerCase());
  }
  return nomes;
}

/** Tabelas referenciadas no DAX. Conservador: só o que é inequivocamente tabela. */
export function referencedTables(dax: string): string[] {
  const locais = locallyDefined(dax);
  const found = new Set<string>();
  for (const m of dax.matchAll(QUOTED)) {
    const nome = m[1]!.trim();
    if (nome && !locais.has(nome.toLowerCase())) found.add(nome);
  }
  for (const m of dax.matchAll(BARE_BEFORE_BRACKET)) {
    const nome = m[2]!.trim();
    if (DAX_KEYWORDS.has(nome.toLowerCase())) continue;
    if (locais.has(nome.toLowerCase())) continue;
    found.add(nome);
  }
  return [...found];
}

/**
 * Lê os nomes do chunk de inventário (`Tabelas do modelo semântico (N): A, B, C`).
 * `[]` quando não há inventário — o chamador então **não** bloqueia nada.
 */
export function parseInventory(chunk: string | null | undefined): string[] {
  if (!chunk) return [];
  const depoisDosDoisPontos = chunk.slice(chunk.indexOf(':') + 1);
  return depoisDosDoisPontos
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
}

/** Os nomes mais parecidos com `alvo`, para o erro sugerir em vez de só recusar. */
export function closestTables(alvo: string, inventory: readonly string[], limit = 3): string[] {
  const f = fold(alvo);
  if (!f) return [];
  const pontuado = inventory
    .map((nome) => {
      const g = fold(nome);
      if (g === f) return { nome, score: 3 };
      if (g.includes(f) || f.includes(g)) return { nome, score: 2 };
      // prefixo em comum de 4+ caracteres já é sinal útil (VISAO_COMERCIAL vs VISAO_VENDAS)
      let i = 0;
      while (i < Math.min(f.length, g.length) && f[i] === g[i]) i++;
      return { nome, score: i >= 4 ? 1 : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return pontuado.slice(0, limit).map((x) => x.nome);
}

export interface DaxCheck {
  /** Tabelas citadas no DAX que não existem no modelo. */
  unknown: string[];
  /** Sugestão por nome desconhecido. */
  suggestions: Record<string, string[]>;
}

/**
 * Confere o DAX contra o inventário. **Inventário vazio → nunca acusa**: sem acervo
 * indexado não há o que validar, e bloquear por ignorância seria pior que o 400.
 */
export function checkDaxTables(dax: string, inventory: readonly string[]): DaxCheck {
  if (inventory.length === 0) return { unknown: [], suggestions: {} };
  const conhecidas = new Set(inventory.map(fold));
  const unknown = referencedTables(dax).filter((t) => !conhecidas.has(fold(t)));
  const suggestions: Record<string, string[]> = {};
  for (const t of unknown) {
    const perto = closestTables(t, inventory);
    if (perto.length > 0) suggestions[t] = perto;
  }
  return { unknown, suggestions };
}

/** Mensagem para o agente: o que está errado, o que existe, e o que fazer. */
export function explainUnknownTables(check: DaxCheck, inventory: readonly string[]): string {
  const linhas = check.unknown.map((t) => {
    const perto = check.suggestions[t];
    return perto ? `  ${t} — você quis dizer: ${perto.join(', ')}?` : `  ${t} — sem equivalente`;
  });
  return [
    `Tabela inexistente no modelo: ${check.unknown.join(', ')}.`,
    ...linhas,
    `Tabelas reais (${inventory.length}): ${inventory.join(', ')}`,
    'Corrija os nomes e chame de novo, ou use `nio_fabric_ask` para gerar o DAX com o schema real.',
  ].join('\n');
}
