/**
 * Guarda de read-only **no código** — primeira das três camadas de defesa do
 * adapter de investigação (as outras: sessão do banco aberta como
 * `READ ONLY`, e a role DQL-only do Postgres, autoritativa — F12-T3/F15).
 *
 * Estratégia: allowlist do verbo inicial + proibição de múltiplas instruções.
 * É defesa-em-profundidade, NÃO a autoridade: um `WITH ... DELETE` começa com
 * `WITH` mas escreve, então a sessão read-only do banco é quem realmente
 * garante. Aqui barramos o óbvio antes de gastar rede.
 */

/** Verbos que iniciam uma consulta puramente de leitura (DQL). */
const READ_ONLY_START = /^(SELECT|WITH|TABLE|VALUES)\b/i;

/** Remove comentários SQL (`-- linha` e `/* bloco *​/`) p/ o verbo não ser mascarado. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * Rejeita (throw) qualquer consulta que não seja DQL de instrução única.
 * Chamada pela implementação do `InvestigationGateway` antes de tocar o banco.
 */
export function assertReadOnlyQuery(sql: string): void {
  const stripped = stripSqlComments(sql).trim().replace(/;+\s*$/, '');

  if (stripped.length === 0) {
    throw new Error('Consulta vazia.');
  }
  if (stripped.includes(';')) {
    throw new Error('Múltiplas instruções não são permitidas na investigação read-only.');
  }
  if (!READ_ONLY_START.test(stripped)) {
    const head = stripped.slice(0, 24);
    throw new Error(
      `Consulta rejeitada: o adapter de investigação é read-only e só aceita DQL ` +
        `(SELECT/WITH/TABLE/VALUES). Início recebido: "${head}…".`,
    );
  }
}
