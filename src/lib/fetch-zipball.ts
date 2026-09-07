/**
 * Download de zipball (GitHub codeload) com timeout e **teto de tamanho**. Sem o
 * teto, um zip malformado / hostil faz o `arrayBuffer()` alocar sem limite
 * (encadeia com a CVE do adm-zip). Usado por `skills-cache` e `adapters/lang/vendor`.
 */

import { readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

/** Teto default: um repo de skills/docs cabe folgado em 64 MiB. */
export const DEFAULT_MAX_ZIP_BYTES = 64 * 1024 * 1024;

export interface FetchZipballOpts {
  timeoutMs: number;
  maxBytes?: number;
}

/**
 * Baixa `url` como `Buffer`, abortando se passar de `maxBytes` (durante o stream,
 * não só pelo `Content-Length` — que pode mentir). Lança em HTTP != 2xx, timeout,
 * ou estouro de tamanho.
 */
export async function fetchZipball(url: string, opts: FetchZipballOpts): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_ZIP_BYTES;
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, opts.timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`zipball grande demais (${declared} bytes > ${maxBytes})`);
    }

    if (!res.body) return Buffer.from(await res.arrayBuffer());

    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > maxBytes) {
        ac.abort();
        throw new Error(`zipball excedeu o teto de ${maxBytes} bytes durante o download`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (timedOut) throw new Error(`timeout após ${opts.timeoutMs}ms baixando ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Monta a URL do codeload pro `ref` — aceita SHA de 40 hex (imutável, é o pin de
 * integridade), tag, ou branch. Branch/tag vão por `refs/heads|tags` implícito do
 * GitHub em `/zip/<ref>`; SHA idem. `owner/repo` já validado pelo chamador.
 */
export function codeloadZipUrl(repo: string, ref: string): string {
  return `https://codeload.github.com/${repo}/zip/${encodeURIComponent(ref)}`;
}

/** `ref` tem forma de commit SHA (40 hex)? Só um SHA garante conteúdo imutável. */
export function isPinnedRef(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref.trim());
}

/**
 * TP-4: recusa symlinks na árvore extraída antes do `cpSync` pro cache. Um
 * zipball hostil poderia trazer `x -> ~/.ssh/id_rsa`; uma leitura posterior de
 * skill/lang seguiria pra fora. Lança no primeiro symlink encontrado.
 */
export function rejectSymlinks(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink() || lstatSync(full).isSymbolicLink()) {
      throw new Error(`entrada symlink recusada no bundle: ${entry.name}`);
    }
    if (entry.isDirectory()) rejectSymlinks(full);
  }
}
