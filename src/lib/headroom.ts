/**
 * Headroom — proxy de compressão de contexto (ADR 0007). Obrigatório pro client
 * de IA: `launchAiClient` sobe o container e aponta o `baseURL` do provider pra
 * cá antes de spawnar o OpenCode. Espelha `src/lib/docker.ts`.
 */
import { spawnSync } from 'node:child_process';
import { env } from '../brand.js';
import { dockerAvailable, portOpen, infraComposePath } from './docker.js';
import { dlog } from './debug.js';

/** Porta do proxy Headroom (loopback only). `NIO_HEADROOM_PORT`, default 8787. */
export const HEADROOM_PORT = Number(env('HEADROOM_PORT')?.trim()) || 8787;

/** baseURL que o provider do OpenCode usa (no host). Override total via `NIO_HEADROOM_URL`. */
export const HEADROOM_URL =
  env('HEADROOM_URL')?.trim() || `http://127.0.0.1:${HEADROOM_PORT}/v1`;

/** Mesma coisa, mas alcançável de dentro de um container (Fase C, futuro). */
export const HEADROOM_URL_CONTAINER = `http://host.docker.internal:${HEADROOM_PORT}/v1`;

/**
 * LLM upstream (OpenAI-compatível) pro modo `direct` (fallback sem Headroom, ADR 0009).
 * É o mesmo alvo que o container do Headroom proxeia (`OPENAI_TARGET_API_URL`).
 */
export const HEADROOM_UPSTREAM =
  env('HEADROOM_OPENAI_TARGET')?.trim() || 'https://opencode.ai/zen/v1';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

  // Stack unificado (docker/docker-compose.yml): sobe só o serviço `headroom`.
  dlog('subindo o Headroom (stack unificado):', infraComposePath());
  const res = spawnSync(
    'docker',
    ['compose', '-f', infraComposePath(), 'up', '-d', 'headroom'],
    { stdio: 'ignore' },
  );
  if (res.status !== 0) {
    return { ok: false, started: false, error: '`docker compose -f docker/... up -d headroom` saiu != 0.' };
  }

  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await headroomHealthy()) return { ok: true, started: true };
  }
  return { ok: false, started: false, error: 'o container subiu mas o Headroom não respondeu em ~30s.' };
}
