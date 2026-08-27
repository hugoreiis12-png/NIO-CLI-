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

// Clientes de IA primários (o `nio init` sobe o que estiver instalado no host —
// ver `primary-client.ts`). Claude Code / Cowork seguem com motor de config em
// `client-configs.ts` mas fora da superfície ativa.
export const CLIENTS: Record<string, ClientInfo> = {
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    binary: 'opencode',
    npm: 'opencode-ai',
    url: 'https://opencode.ai/docs',
  },
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    binary: 'codex',
    npm: '@openai/codex',
    url: 'https://developers.openai.com/codex/cli',
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
