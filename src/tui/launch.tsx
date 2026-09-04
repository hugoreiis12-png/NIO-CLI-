/**
 * `launchNioTui` — o branch interativo do client de IA (Fase 2): Headroom +
 * `opencode serve` headless + interface NIO (Ink). Degrada pra TUI do OpenCode
 * (sem TTY / sem `opencode` / server não sobe).
 */
import { spawn } from 'node:child_process';
import React from 'react';
import { render } from 'ink';
import { ensureHeadroomAndWire } from '../app/ai-client.js';
import { isBinaryInstalled } from '../lib/clients/client-install.js';
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
    const child = spawn('opencode', [], { stdio: 'inherit', cwd });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(127));
  });
}

export async function launchNioTui({ cwd }: { cwd: string }): Promise<number> {
  await ensureHeadroomAndWire(); // best-effort (ADR 0009): remoto → local → direto, nunca bloqueia

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('  `nio ai` precisa de um terminal interativo.');
    return 1;
  }
  if (!isBinaryInstalled('opencode')) {
    console.log(`  ${c.yellow(sym.warn)} OpenCode não está no PATH. Instale com \`npm i -g opencode-ai\`.`);
    return 127;
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
