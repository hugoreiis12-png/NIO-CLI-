/**
 * Pré-visualização das duas cenas do personagem, sem vLLM/opencode:
 *  1. "Quem é você?" (suspense → personagem medium → apresentação; Esc pula)
 *  2. ícone compacto acima do "pensando" (8 s)
 * Uso: `bun run preview:avatar`. Precisa de TTY; ideal ≥ 100×34.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, render, useApp } from 'ink';
import { ThinkingAvatar } from '../src/tui/avatar-view.js';
import { useIdentity } from '../src/tui/identity-reveal.js';

const THINKING_MS = 8000;
const TICK_MS = 90;

function Preview(): React.ReactElement {
  const { exit } = useApp();
  const rows = process.stdout.rows ?? 24;
  const identity = useIdentity(rows, process.stdout.columns ?? 80);
  const [phase, setPhase] = useState<'identity' | 'thinking'>('identity');
  const [frame, setFrame] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    identity.tryStart('Quem é você?');
  }, []);
  useEffect(() => {
    if (identity.active) started.current = true;
    else if (started.current) setPhase('thinking');
  }, [identity.active]);
  useEffect(() => {
    if (phase !== 'thinking') return;
    const tick = setInterval(() => setFrame((f) => f + 1), TICK_MS);
    const stop = setTimeout(exit, THINKING_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [phase]);

  return (
    <Box flexDirection="column">
      {identity.node}
      <ThinkingAvatar active={phase === 'thinking'} frame={frame} rows={rows} />
      {phase === 'thinking' && <Text color="yellow"> ⠋ pensando… (preview — Ctrl+C sai)</Text>}
    </Box>
  );
}

if (!process.stdout.isTTY) {
  console.error('preview-avatar precisa de um terminal interativo (TTY).');
  process.exit(1);
}
if ((process.stdout.rows ?? 0) < 32) {
  console.error(
    'Aviso: terminal com menos de 32 linhas — o ícone e o personagem medium encolhem ou somem.',
  );
}
render(<Preview />);
