import { spawnSync } from 'node:child_process';

/**
 * Metadados dos clientes de IA suportados — pra checar se estão instalados e
 * orientar a instalação (comando npm pra CLIs, link de download pra apps).
 */
export interface ClientInfo {
  id: string;
  label: string;
  /** Binário no PATH pra detectar presença (CLIs). */
  binary?: string;
  /** Pacote npm global pra oferecer instalar (CLIs). */
  npm?: string;
  /** Docs / download. */
  url: string;
}

// Só OpenCode por enquanto (decisão de 2026-07-27) — Claude Code/Codex/VS
// Code/Cowork saem da superfície ativa. O motor de config de cada um
// continua em client-configs.ts (não apagado), só não é mais oferecido.
export const CLIENTS: Record<string, ClientInfo> = {
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    binary: 'opencode',
    npm: 'opencode-ai',
    url: 'https://opencode.ai/docs',
  },
};

/** Detecta se um binário existe no PATH (roda `<bin> --version`). */
export function isBinaryInstalled(binary: string): boolean {
  try {
    const res = spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 5000 });
    // ENOENT → não está no PATH. Qualquer exit code (mesmo != 0) = existe.
    return !res.error;
  } catch {
    return false;
  }
}
