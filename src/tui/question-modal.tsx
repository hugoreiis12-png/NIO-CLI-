/**
 * Modal da tool `question` — como o usuário responde quando o modelo pergunta antes
 * de executar.
 *
 * Três modos, conforme o que o motor manda em cada pergunta:
 * - escolha única (default) — ↑↓ + ↵
 * - `multi` — Espaço marca/desmarca, ↵ envia as marcadas
 * - `custom` — digitar escreve uma resposta fora das opções
 *
 * `custom` não é enfeite: sem ele, uma pergunta cujas opções não cobrem o caso real
 * vira beco sem saída — não há como dizer "nenhuma dessas".
 */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, sym } from './theme.js';
import type { QuestionReq } from './state.js';

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Rodapé de atalhos — muda com o modo da pergunta. */
function hints(multi: boolean, custom: boolean, digitando: boolean): string {
  if (digitando) return '↵ enviar o texto · ⌫ apagar · Esc cancelar';
  const base = multi ? '↑↓ mover · Espaço marcar · ↵ enviar' : '↑↓ escolher · ↵ responder';
  return custom ? `${base} · digite para responder livremente · Esc cancelar` : `${base} · Esc cancelar`;
}

export function QuestionModal({
  req,
  queued,
  onAnswer,
  onReject,
}: {
  req: QuestionReq;
  /** total na fila (contando este) — `>1` mostra "+N na fila". */
  queued: number;
  onAnswer: (answers: string[][]) => void;
  onReject: () => void;
}): React.ReactElement {
  const [qIdx, setQIdx] = useState(0);
  const [sel, setSel] = useState(0);
  const [marks, setMarks] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<string[][]>([]);

  const q = req.questions[qIdx];
  const opts = q?.options ?? [];
  const total = req.questions.length;
  const multi = Boolean(q?.multi);
  const custom = Boolean(q?.custom);
  const digitando = draft.length > 0;

  /** O que esta pergunta devolve: o texto livre vence as opções. */
  const currentAnswer = (): string[] => {
    if (digitando) return [draft.trim()];
    if (multi && marks.size > 0) return [...marks].sort((a, b) => a - b).map((i) => opts[i]?.label ?? '');
    return [opts[sel]?.label ?? ''];
  };

  const advance = (): void => {
    const next = [...picked, currentAnswer()];
    if (qIdx + 1 >= total) return onAnswer(next);
    setPicked(next);
    setQIdx(qIdx + 1);
    setSel(0);
    setMarks(new Set());
    setDraft('');
  };

  useInput((input, key) => {
    if (key.escape) return onReject();
    if (key.return) return advance();
    if (key.backspace || key.delete) return setDraft((d) => d.slice(0, -1));
    if (key.upArrow) return setSel((n) => Math.max(0, n - 1));
    if (key.downArrow) return setSel((n) => Math.min(opts.length - 1, n + 1));
    if (multi && input === ' ') {
      return setMarks((prev) => {
        const next = new Set(prev);
        if (next.has(sel)) next.delete(sel);
        else next.add(sel);
        return next;
      });
    }
    // Só escreve quando a pergunta permite — senão um toque perdido viraria resposta.
    if (custom && input && !key.ctrl && !key.meta) setDraft((d) => d + input);
  });

  const marca = (i: number): string => {
    if (!multi) return `${i + 1}.`;
    return marks.has(i) ? '[x]' : '[ ]';
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accentBright} paddingX={1}>
      <Text color={theme.accentBright}>
        {sym.bullet} o nio perguntou
        {total > 1 ? <Text color={theme.dim}>{`  (${qIdx + 1}/${total})`}</Text> : null}
        {queued > 1 ? <Text color={theme.dim}>{`  (+${queued - 1} na fila)`}</Text> : null}
      </Text>
      {q?.header ? <Text color={theme.dim}>{clip(q.header, 78)}</Text> : null}
      <Text color={theme.text} wrap="truncate-end">{clip(q?.question ?? '', 78)}</Text>
      {opts.map((o, i) => (
        <Text
          key={o.label || i}
          inverse={!digitando && i === sel}
          color={!digitando && i === sel ? theme.accentBright : undefined}
          wrap="truncate-end"
        >
          {' '}
          {marca(i)} {o.label}
          {o.description ? <Text color={theme.dim}>{` — ${clip(o.description, 50)}`}</Text> : null}
        </Text>
      ))}
      {custom ? (
        <Text color={digitando ? theme.text : theme.dim} wrap="truncate-end">
          {` ${sym.bullet} outra resposta: ${draft || '(digite para escrever)'}`}
        </Text>
      ) : null}
      <Text color={theme.dim}>{hints(multi, custom, digitando)}</Text>
    </Box>
  );
}
