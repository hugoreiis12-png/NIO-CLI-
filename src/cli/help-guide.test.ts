import { test, expect } from 'bun:test';
import { usageGuide } from './help-guide.js';
import { buildProgram } from './program.js';

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

test('usageGuide: cobre o fluxo de começo e a UX do `nio ai`', () => {
  const g = strip(usageGuide());
  // primeiros passos
  for (const n of ['nio config setup', 'nio register', 'nio init', 'nio ai']) {
    expect(g).toContain(n);
  }
  // a interface do nio ai — teclas/conceitos que o usuário precisa saber
  for (const k of ['Ctrl-J', 'Tab', '/', 'Ctrl-R', 'Permissão', '+N na fila', 'nio docs']) {
    expect(g).toContain(k);
  }
});

/** Captura o que `cmd.outputHelp()` escreve (é onde o commander roda os hooks). */
function helpOf(cmd: { outputHelp: () => void }): string {
  let out = '';
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
  try {
    cmd.outputHelp();
  } finally {
    process.stdout.write = orig;
  }
  return strip(out);
}

test('o guia entra no `nio --help` do topo, não no de um subcomando', () => {
  const program = buildProgram();
  expect(helpOf(program)).toContain('A INTERFACE DO');

  const ai = program.commands.find((c) => c.name() === 'ai')!;
  expect(helpOf(ai)).not.toContain('A INTERFACE DO');
});
