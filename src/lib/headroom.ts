/**
 * Headroom — proxy de compressão de contexto (ADR 0007). Obrigatório pro client
 * de IA: `launchAiClient` sobe o container e aponta o `baseURL` do provider pra
 * cá antes de spawnar o OpenCode. Espelha `src/lib/docker.ts`.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { env } from '../brand.js';
import { dockerAvailable, portOpen } from './docker.js';
import { dlog } from './debug.js';

/** Porta do proxy Headroom (loopback only). `NIO_HEADROOM_PORT`, default 8787. */
export const HEADROOM_PORT = Number(env('HEADROOM_PORT')?.trim()) || 8787;

/** baseURL que o provider do OpenCode usa (no host). Override total via `NIO_HEADROOM_URL`. */
export const HEADROOM_URL =
  env('HEADROOM_URL')?.trim() || `http://127.0.0.1:${HEADROOM_PORT}/v1`;

/** Mesma coisa, mas alcançável de dentro de um container (Fase C, futuro). */
export const HEADROOM_URL_CONTAINER = `http://host.docker.internal:${HEADROOM_PORT}/v1`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `headroom/docker-compose.yml` do pacote — constante, não entrada do usuário. */
export function headroomComposePath(): string {
  // Compila pra `dist/lib/headroom.js`; a raiz do pacote é dois níveis acima.
  return join(fileURLToPath(new URL('../..', import.meta.url)), 'headroom', 'docker-compose.yml');
}

/** O container do Headroom (`nio-headroom`) está escutando? TCP puro. */
export function headroomHealthy(): Promise<boolean> {
  return portOpen(HEADROOM_PORT);
}

export interface HeadroomEnsureResult {
  ok: boolean;
  /** `true` se este processo subiu o container agora (vs. já estar no ar). */
  started: boolean;
  error?: string;
}

/**
 * Garante o Headroom no ar: já responde → nada; senão `docker compose up -d` e
 * espera o `/livez` (via TCP, ~30s). Nunca lança — devolve `{ ok, error? }`.
 */
export async function ensureHeadroomRunning(): Promise<HeadroomEnsureResult> {
  if (await headroomHealthy()) return { ok: true, started: false };

  if (!dockerAvailable()) {
    return {
      ok: false,
      started: false,
      error:
        'Docker não encontrado (ou `docker compose` indisponível). O Headroom roda em ' +
        'container e é obrigatório pro client de IA — instale/inicie o Docker Engine/Desktop.',
    };
  }

  dlog('subindo o Headroom:', headroomComposePath());
  const res = spawnSync(
    'docker',
    ['compose', '-f', headroomComposePath(), 'up', '-d'],
    { stdio: 'ignore', env: { ...process.env, NIO_HEADROOM_PORT: String(HEADROOM_PORT) } },
  );
  if (res.status !== 0) {
    return { ok: false, started: false, error: '`docker compose -f headroom/... up -d` saiu != 0.' };
  }

  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await headroomHealthy()) return { ok: true, started: true };
  }
  return { ok: false, started: false, error: 'o container subiu mas o Headroom não respondeu em ~30s.' };
}

/** `docker compose -f headroom/... <args>` herdando o terminal. Exit code. */
export function headroomCompose(args: string[]): number {
  const res = spawnSync(
    'docker',
    ['compose', '-f', headroomComposePath(), ...args],
    { stdio: 'inherit', env: { ...process.env, NIO_HEADROOM_PORT: String(HEADROOM_PORT) } },
  );
  return res.status ?? 1;
}
