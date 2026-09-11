import { binaryOnPath, spawnSyncPortable } from '../proc.js';
import { OPENCODE_SDK_VERSION } from '../../version.js';

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

// Só OpenCode por enquanto (decisão de 2026-07-27) — Claude Code/Codex saem da
// superfície ativa (o config deles foi removido). O VS Code segue via
// client-configs (`installVSCodeRepo`), o Cowork via Claude Desktop.
export const CLIENTS: Record<string, ClientInfo> = {
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    binary: 'opencode',
    npm: 'opencode-ai',
    url: 'https://opencode.ai/docs',
  },
};

/**
 * Detecta se um binário existe no PATH. Só resolve o caminho — não executa (ver
 * `binaryOnPath`: rodar `<bin> --version` trava com binários que não tratam a
 * flag, como o `nio-gateway`).
 */
export function isBinaryInstalled(binary: string): boolean {
  return binaryOnPath(binary);
}

/** `major.minor` de uma string de versão (`"1.18.26"` → `"1.18"`). */
function majorMinor(v: string): string {
  return v.split('.').slice(0, 2).join('.');
}

/** Versão `x.y.z` do binário `opencode` no PATH, ou `null` se não deu pra ler. */
export function opencodeBinaryVersion(): string | null {
  try {
    const res = spawnSyncPortable('opencode', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (res.error) return null;
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(`${res.stdout ?? ''}${res.stderr ?? ''}`);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

/**
 * O `opencode` no PATH está numa minor compatível com o SDK que a CLI embute?
 * `null` = alinhado (ou não deu pra checar). Só compara `major.minor` — patch
 * pode divergir (auditoria §4.2). Warn-only: o caller avisa, não bloqueia.
 */
export function opencodeVersionSkew(): { binary: string; sdk: string } | null {
  const binary = opencodeBinaryVersion();
  if (!binary || !OPENCODE_SDK_VERSION) return null;
  return majorMinor(binary) === majorMinor(OPENCODE_SDK_VERSION)
    ? null
    : { binary, sdk: OPENCODE_SDK_VERSION };
}
