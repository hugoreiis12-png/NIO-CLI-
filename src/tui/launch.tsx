/**
 * Launch da interface TUI do NIO (Ink + React). Se não houver terminal interativo, ou se o Opencode não estiver no PATH
 */
import { spawnPortable } from '../lib/proc.js';
import React from 'react';
import { render } from 'ink';
import { ensureHeadroomAndWire } from '../app/ai-client.js';
import { isBinaryInstalled, opencodeVersionSkew } from '../lib/clients/client-install.js';
import { loadSession } from '../lib/auth/session-store.js';
import { createSessionRepository } from '../adapters/pg/session-repository.js';
import { buildProgram } from '../cli/program.js';
import { c, sym } from '../lib/colors.js';
import { startOpencode } from './opencode.js';
import { App } from './app.js';

async function resolveSessionMeta(): Promise<{ name: string; profile: string; id: string } | null> {
  try {
    const stored = await loadSession();
    if (!stored) return null;
    const active = await createSessionRepository().findActiveByUser(stored.userId);
    return active ? { name: active.name, profile: active.profile, id: active.id } : null;
  } catch {
    return null;
  }
}

function fallbackToOpencodeTui(cwd: string): Promise<number> {
  console.log(c.dim('  (interface NIO indisponível — abrindo a TUI do OpenCode)'));
  return new Promise((resolve) => {
    const child = spawnPortable('opencode', [], { stdio: 'inherit', cwd });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(127));
  });
}

export async function launchNioTui({ cwd }: { cwd: string }): Promise<number> {
  await ensureHeadroomAndWire(); // Headroom DESATIVADO: só garante o opencode.json (provider direto, model)

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('  `nio ai` precisa de um terminal interativo.');
    return 1;
  }
  if (!isBinaryInstalled('opencode')) {
    console.log(`  ${c.yellow(sym.warn)} OpenCode não está no PATH. Instale com \`npm i -g opencode-ai\`.`);
    return 127;
  }
  const skew = opencodeVersionSkew();
  if (skew) {
    console.log(
      `  ${c.yellow(sym.warn)} opencode ${skew.binary} no PATH, mas a NIO fala com o SDK ${skew.sdk}. ` +
        `Se o chat travar ou os eventos sumirem, alinhe: \`npm i -g opencode-ai@${skew.sdk}\`.`,
    );
  }

  let handle;
  try {
    handle = await startOpencode(cwd);
  } catch (err) {
    console.error(`  ${c.yellow(sym.warn)} opencode serve não subiu: ${(err as Error).message}`);
    return fallbackToOpencodeTui(cwd);
  }

  const program = buildProgram();
  const session = await resolveSessionMeta();
  const app = render(<App handle={handle} program={program} cwd={cwd} session={session} />, {
    patchConsole: false, // nada de console fora do controle do Ink
    exitOnCtrlC: true,
  });
  try {
    await app.waitUntilExit();
  } finally {
    handle.close();
  }
  return 0;
}
