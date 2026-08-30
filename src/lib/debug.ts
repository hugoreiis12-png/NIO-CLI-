/**
 * Modo debug — `NIO_DEBUG=1` (ou `true`/`yes`). Liga stack trace completo nos
 * erros e um log `[nio:debug]` em pontos-chave (resolução de config, requests
 * pro gateway, wizard). Tudo em stderr — nunca polui o stdout do MCP/JSON.
 */
export const DEBUG = /^(1|true|yes|on)$/i.test((process.env.NIO_DEBUG ?? '').trim());

/** Log condicional em stderr. Só imprime com `NIO_DEBUG` ligado. */
export function dlog(...args: unknown[]): void {
  if (DEBUG) console.error('[nio:debug]', ...args);
}
