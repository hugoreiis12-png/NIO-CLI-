/**
 * Paleta `/` + painel de info + runner de comando + modal de permissão.
 * As 3 ações do dono: comando → info · comando → executa e mostra · capacidade → prompt.
 */
import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { theme, sym } from './theme.js';
import { buildPalette, filterPalette, type PaletteItem } from './palette-source.js';
import type { Command } from 'commander';

const KIND_LABEL: Record<PaletteItem['kind'], string> = {
  command: 'cmd',
  capability: 'agente',
  help: 'ajuda',
};

export function Palette({
  program,
  onClose,
  onInfo,
  onRun,
  onPrompt,
}: {
  program: Command;
  onClose: () => void;
  onInfo: (item: PaletteItem) => void;
  onRun: (item: Extract<PaletteItem, { kind: 'command' }>) => void;
  onPrompt: (prompt: string) => void;
}): React.ReactElement {
  const all = useMemo(() => buildPalette(program), [program]);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const items = useMemo(() => filterPalette(all, q).slice(0, 40), [all, q]);
  const sel = items[Math.min(i, items.length - 1)];

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.upArrow) return setI((n) => Math.max(0, n - 1));
    if (key.downArrow) return setI((n) => Math.min(items.length - 1, n + 1));
    if (key.return) {
      if (!sel) return;
      if (sel.kind === 'capability') { onPrompt(sel.prompt); onClose(); return; }
      onInfo(sel);
      return;
    }
    if (key.ctrl && input === 'r' && sel?.kind === 'command') { onRun(sel); onClose(); return; }
    if (key.backspace || key.delete) return setQ((v) => v.slice(0, -1));
    if (input && !key.ctrl && !key.meta) setQ((v) => v + input);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text><Text color={theme.accent}>/</Text>{q}<Text color={theme.dim}>█</Text></Text>
      {items.map((it, n) => (
        <Text key={`${it.kind}-${it.name}`} color={n === i ? theme.accentBright : undefined} inverse={n === i}>
          {' '}[{KIND_LABEL[it.kind]}] {it.name}  <Text color={theme.dim}>{it.desc}</Text>
        </Text>
      ))}
      <Text color={theme.dim}>
        ↑↓ mover · Enter {sel?.kind === 'capability' ? 'manda pro agente' : 'info'} ·
        {sel?.kind === 'command' ? ' Ctrl-R roda ·' : ''} Esc fecha
      </Text>
    </Box>
  );
}

export function InfoPanel({ item, onClose }: { item: PaletteItem; onClose: () => void }): React.ReactElement {
  useInput((_i, key) => {
    if (key.escape || key.return) onClose();
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text bold color={theme.accentBright}>{item.name}</Text>
      <Text>{item.desc}</Text>
      {item.kind === 'command' && (
        <Box marginTop={1}>
          <Text color={theme.dim}>rode: </Text>
          <Text color={theme.accent}>{item.line}</Text>
        </Box>
      )}
      {item.kind === 'help' && <Box marginTop={1}><Text>{item.body}</Text></Box>}
      <Text color={theme.dim}>Esc fecha</Text>
    </Box>
  );
}

export function CommandRunner({
  item,
  cwd,
  onClose,
}: {
  item: Extract<PaletteItem, { kind: 'command' }>;
  cwd: string;
  onClose: () => void;
}): React.ReactElement {
  const [confirmed, setConfirmed] = useState(!item.destructive);
  const [out, setOut] = useState('');
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    if (!confirmed) return;
    const parts = item.name.split(' ');
    const child = spawn('nio', parts, { cwd });
    child.stdout.on('data', (d) => setOut((o) => (o + d).slice(-4000)));
    child.stderr.on('data', (d) => setOut((o) => (o + d).slice(-4000)));
    child.on('exit', (code) => setDone(code ?? 1));
    child.on('error', (e) => { setOut((o) => o + '\n' + e.message); setDone(127); });
    return () => {
      child.kill();
    };
  }, [confirmed, item.name, cwd]);

  useInput((input, key) => {
    if (!confirmed) {
      if (input.toLowerCase() === 's') setConfirmed(true);
      else if (key.escape || input.toLowerCase() === 'n') onClose();
      return;
    }
    if (done !== null && (key.escape || key.return)) onClose();
  });

  if (!confirmed) {
    return (
      <Box borderStyle="round" borderColor={theme.warn} paddingX={1}>
        <Text color={theme.warn}>{sym.warn} `{item.line}` pode alterar/apagar coisas. Rodar? [s/N]</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent}>$ {item.line}</Text>
      <Text color={theme.dim}>{out.split('\n').slice(-12).join('\n') || '…'}</Text>
      {done !== null && (
        <Text color={done === 0 ? theme.accent : theme.err}>exit {done} · Esc fecha</Text>
      )}
    </Box>
  );
}

export function PermissionModal({
  title,
  onRespond,
}: {
  title: string;
  onRespond: (r: 'once' | 'always' | 'reject') => void;
}): React.ReactElement {
  useInput((input) => {
    const k = input.toLowerCase();
    if (k === 'a') onRespond('once');
    else if (k === 's') onRespond('always');
    else if (k === 'd') onRespond('reject');
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warn} paddingX={1}>
      <Text color={theme.warn}>{sym.warn} O operador pede permissão:</Text>
      <Text>{title}</Text>
      <Text color={theme.dim}>[a] permitir · [s] sempre · [d] negar</Text>
    </Box>
  );
}
