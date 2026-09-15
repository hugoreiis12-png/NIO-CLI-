/** Saída graciosa do CLI — sem o crash libuv do `process.exit()` com handles vivas. */
const FORCE_EXIT_AFTER_MS = 1500;

export interface ShutdownOpts {
  /** Teto da drenagem; `< 0` desliga a saída forçada (testes). */
  forceExitAfterMs?: number;
}

/** Fecha o pool do Postgres se algum comando abriu um (lazy: não puxa o `pg` no cold start). */
export async function closeDbIfOpen(): Promise<void> {
  if (!(globalThis as Record<string, unknown>).__nioPgPoolOpen) return;
  try {
    await import('../adapters/pg/client.js').then((m) => m.closePool());
  } catch {
    /* sair importa mais que o erro do cleanup */
  }
}

/** Limpa (pool, stdin), seta `exitCode` e deixa o loop drenar; força a saída no teto. */
export async function shutdown(code = 0, opts: ShutdownOpts = {}): Promise<void> {
  const forceAfter = opts.forceExitAfterMs ?? FORCE_EXIT_AFTER_MS;
  if (forceAfter >= 0) {
    const timer = setTimeout(() => process.exit(code), forceAfter);
    timer.unref();
  }
  await closeDbIfOpen();
  try {
    process.stdin.destroy();
  } catch {
    /* sem stdin */
  }
  process.exitCode = code;
}
