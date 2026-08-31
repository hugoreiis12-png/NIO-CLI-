/**
 * Overlays da paleta: painel de info · runner de comando · modal de permissão.
 * (A lista `/` em si é inline no `InputBox` — `SlashList` em `components.tsx`.)
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { theme, sym } from './theme.js';
import type { PaletteItem } from './palette-source.js';

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
