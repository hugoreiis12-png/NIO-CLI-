/**
 * Overlays da paleta: painel de info · runner de comando · modal de permissão.
 * (A lista `/` em si é inline no `InputBox` — `SlashList` em `components.tsx`.)
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { theme, sym } from './theme.js';
import { permGroupLabel, type PermissionReq } from './state.js';
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

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Modal de permissão (Sprint 7.1). Genérico — funciona pra qualquer um dos ~40
 * `kind` (bash/edit/read/webfetch/MCP…). Mostra o grupo, o comando/patterns, e o
 * que a opção "sempre" vai salvar como regra. `total > 1` = há uma fila.
 */
export function PermissionModal({
  req,
  queued,
  onRespond,
}: {
  req: PermissionReq;
  /** total de pedidos na fila (contando este) — `>1` mostra "+N na fila". */
  queued: number;
  onRespond: (r: 'once' | 'always' | 'reject') => void;
}): React.ReactElement {
  useInput((input, key) => {
    const k = input.toLowerCase();
    if (k === 'a' || key.return) onRespond('once');
    else if (k === 's') onRespond('always');
    else if (k === 'd' || key.escape) onRespond('reject');
  });

  const detail = req.command
    ? [`$ ${req.command}`]
    : req.patterns.length
      ? req.patterns.slice(0, 4)
      : [permGroupLabel(req.kind)];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warn} paddingX={1}>
      <Text color={theme.warn}>
        {sym.warn} permissão — <Text bold>{permGroupLabel(req.kind)}</Text>
        {queued > 1 ? <Text color={theme.dim}>{`  (+${queued - 1} na fila)`}</Text> : null}
      </Text>
      {detail.map((d, i) => (
        <Text key={i} color={theme.text} wrap="truncate-end">
          {'  '}
          {clip(d, 78)}
        </Text>
      ))}
      {req.always.length > 0 && (
        <Text color={theme.dim} wrap="truncate-end">
          {'  sempre = '}
          {req.always.slice(0, 5).join(', ')}
        </Text>
      )}
      <Text color={theme.dim}>[a]/↵ permitir · [s] sempre · [d]/Esc negar</Text>
    </Box>
  );
}
