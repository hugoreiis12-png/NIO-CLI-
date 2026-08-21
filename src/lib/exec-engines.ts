import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { envName } from '../brand.js';

/**
 * Registro central dos engines da delegação headless. É o **único** lugar que conhece
 * nome de binário, candidatos de PATH e flags. Adicionar engine = adicionar uma entrada.
 */

export const ENGINES = ['codex', 'claude'] as const;
export type Engine = (typeof ENGINES)[number];

export const DEFAULT_ENGINE: Engine = 'codex';

/** Planejar pede raciocínio; executar pede velocidade — daí o default por verbo. */
export const PLAN_ENGINE: Engine = 'claude';

interface EngineSpec {
  bin: string;
  candidates: string[];
  binEnv: string;
  argsEnv: string;
  args: (prompt: string) => string[];
  missing: string;
}

// O MCP é spawnado por app GUI, com PATH mínimo — daí a busca em locais conhecidos.
function knownPaths(bin: string, ...extra: string[]): string[] {
  return [
    join(homedir(), '.local', 'bin', bin),
    '/opt/homebrew/bin/' + bin,
    '/usr/local/bin/' + bin,
    ...extra,
  ];
}

const SPECS: Record<Engine, EngineSpec> = {
  codex: {
    bin: 'codex',
    candidates: knownPaths('codex'),
    binEnv: envName('CODEX_BIN'),
    argsEnv: envName('CODEX_ARGS'),
    args: (prompt) => ['exec', '--full-auto', prompt],
    missing: `codex não encontrado — instale/logue (\`codex login\`) ou defina ${envName('CODEX_BIN')}`,
  },
  claude: {
    bin: 'claude',
    candidates: knownPaths('claude', join(homedir(), '.claude', 'local', 'claude')),
    binEnv: envName('CLAUDE_BIN'),
    argsEnv: envName('CLAUDE_ARGS'),
    args: (prompt) => ['-p', prompt, '--permission-mode', 'acceptEdits'],
    missing: `claude não encontrado — instale/logue (\`claude login\`) ou defina ${envName('CLAUDE_BIN')}`,
  },
};

export function isEngine(value: unknown): value is Engine {
  return typeof value === 'string' && (ENGINES as readonly string[]).includes(value);
}

/** Normaliza o valor pedido; ausente → default do verbo; inválido → `null` (o caller reporta). */
export function parseEngine(value?: string | null, fallback: Engine = DEFAULT_ENGINE): Engine | null {
  if (value === undefined || value === null || value === '') return fallback;
  return isEngine(value) ? value : null;
}

export function engineMissingError(engine: Engine): string {
  return SPECS[engine].missing;
}

/** Args headless do engine; `NIO_<ENGINE>_ARGS` sobrescreve (prompt vai no fim). */
export function engineArgs(engine: Engine, prompt: string): string[] {
  const spec = SPECS[engine];
  const override = process.env[spec.argsEnv];
  if (override && override.trim()) return [...override.trim().split(/\s+/), prompt];
  return spec.args(prompt);
}

/** Acha o binário: override de env, depois PATH, depois os candidatos conhecidos. */
export function resolveEngineBin(engine: Engine): string | null {
  const spec = SPECS[engine];
  const override = process.env[spec.binEnv];
  if (override && existsSync(override)) return override;
  const onPath = spawnSync(spec.bin, ['--version'], { stdio: 'ignore' });
  if (!onPath.error) return spec.bin;
  return spec.candidates.find((p) => existsSync(p)) ?? null;
}
