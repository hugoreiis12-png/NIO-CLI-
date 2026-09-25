import { test, expect } from 'bun:test';
import {
  shouldAbortCompaction,
  toolAttempts,
  failedTools,
  applyEvent,
  reconcilePendingPermissions,
  reconcilePendingQuestions,
  pushUserMessage,
  emptyChat,
  summarizeToolInput,
  messageUsage,
  contextUsage,
  pendingQuestion,
  questionOptions,
  looksLikeScaffolding,
  isInternalMessage,
  stripReasoningTags,
  shouldCompact,
} from './state.js';
import type { ChatMessage } from './state.js';
import type { Event } from '@opencode-ai/sdk';

const ev = (type: string, properties: unknown): Event => ({ type, properties } as unknown as Event);

test('fluxo típico: eco do usuário é reconciliado, reasoning separado do texto, idle limpa busy', () => {
  let s = pushUserMessage(emptyChat, 'Diga PONG');
  expect(s.messages).toHaveLength(1);
  expect(s.busy).toBe(true);

  // mensagem real do usuário → substitui o eco `pending-user`
  s = applyEvent(s, ev('message.updated', { info: { id: 'msg_u', role: 'user' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'text', text: 'Diga PONG', messageID: 'msg_u', id: 'prt_u' } }));
  expect(s.messages.filter((m) => m.role === 'user')).toHaveLength(1);
  expect(s.messages[0].id).toBe('msg_u');

  // assistant: step-start (ignorado) + reasoning + text streamado
  s = applyEvent(s, ev('message.updated', { info: { id: 'msg_a', role: 'assistant' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'step-start', messageID: 'msg_a', id: 'prt_s' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'reasoning', text: 'pensa...', messageID: 'msg_a', id: 'prt_r' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'text', text: '', messageID: 'msg_a', id: 'prt_t' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'text', text: 'PONG', messageID: 'msg_a', id: 'prt_t' } }));

  const a = s.messages.find((m) => m.role === 'assistant')!;
  expect(a.parts.find((p) => p.id === 'prt_s')).toBeUndefined(); // step-start não vira parte
  expect(a.parts.find((p) => p.kind === 'reasoning')?.text).toBe('pensa...');
  expect(a.parts.find((p) => p.kind === 'text')?.text).toBe('PONG'); // último snapshot vence

  s = applyEvent(s, ev('session.idle', { sessionID: 'ses_x' }));
  expect(s.busy).toBe(false);
});

test('tool part: nome + título + status + input + output (e error vira output)', () => {
  let s = emptyChat;
  s = applyEvent(s, ev('message.part.updated', {
    part: { type: 'tool', tool: 'read', messageID: 'msg_a', id: 'prt_tool',
      state: { status: 'completed', title: 'Lendo x.ts', output: 'conteúdo', input: { filePath: 'x.ts' } } },
  }));
  const tp = s.messages[0].parts[0];
  expect(tp.kind).toBe('tool');
  expect(tp.text).toBe('Lendo x.ts');
  expect(tp.tool).toEqual({ name: 'read', status: 'completed', input: { filePath: 'x.ts' }, output: 'conteúdo' });

  s = applyEvent(s, ev('message.part.updated', {
    part: { type: 'tool', tool: 'bash', messageID: 'msg_a', id: 'prt_err',
      state: { status: 'error', error: 'falhou feio' } },
  }));
  expect(s.messages[0].parts[1].tool).toEqual({ name: 'bash', status: 'error', input: undefined, output: 'falhou feio' });
});

test('Sprint 2 — todo.updated vira a checklist do estado', () => {
  let s = pushUserMessage(emptyChat, 'faça X');
  expect(s.todos).toEqual([]);
  s = applyEvent(s, ev('todo.updated', {
    sessionID: 's',
    todos: [
      { content: 'Ler o adapter', status: 'completed', priority: 'high' },
      { content: 'Trocar o port', status: 'in_progress', priority: 'high' },
      { content: 'Rodar os testes', status: 'pending', priority: 'medium' },
    ],
  }));
  expect(s.todos).toEqual([
    { content: 'Ler o adapter', status: 'completed' },
    { content: 'Trocar o port', status: 'in_progress' },
    { content: 'Rodar os testes', status: 'pending' },
  ]);
  // novo prompt zera a checklist
  expect(pushUserMessage(s, 'próximo').todos).toEqual([]);
});

test('Sprint 2 — file.edited acumula (dedup) os arquivos da volta', () => {
  let s = pushUserMessage(emptyChat, 'edite');
  s = applyEvent(s, ev('file.edited', { file: 'src/a.ts' }));
  s = applyEvent(s, ev('file.edited', { file: 'src/b.ts' }));
  s = applyEvent(s, ev('file.edited', { file: 'src/a.ts' })); // dup
  expect(s.files).toEqual(['src/a.ts', 'src/b.ts']);
});

test('Sprint 2 — session.status retry marca/limpa a tentativa', () => {
  let s = applyEvent({ ...emptyChat, busy: true }, ev('session.status', {
    status: { type: 'retry', attempt: 2, message: 'rate limit', next: 0 },
  }));
  expect(s.retry).toEqual({ attempt: 2, note: 'rate limit' });
  s = applyEvent(s, ev('session.idle', { sessionID: 's' }));
  expect(s.retry).toBeNull();
});

test('Sprint 2 — step-finish vira part `step` com tokens/custo; messageUsage soma', () => {
  let s = applyEvent(emptyChat, ev('message.updated', { info: { id: 'm', role: 'assistant' } }));
  s = applyEvent(s, ev('message.part.updated', {
    part: { type: 'step-finish', messageID: 'm', id: 'st1', tokens: { input: 1000, output: 200 }, cost: 0.01 },
  }));
  s = applyEvent(s, ev('message.part.updated', {
    part: { type: 'step-finish', messageID: 'm', id: 'st2', tokens: { input: 300, output: 400 }, cost: 0.005 },
  }));
  const msg = s.messages.find((m) => m.role === 'assistant')!;
  expect(msg.parts.filter((p) => p.kind === 'step')).toHaveLength(2);
  expect(messageUsage(msg)).toEqual({ tokensIn: 1300, tokensOut: 600, cost: 0.015 });
});

test('Bug mídia — part compaction_continue vira marcador conciso (não parágrafo longo)', () => {
  let s = applyEvent(emptyChat, ev('message.updated', { info: { id: 'm', role: 'assistant' } }));
  s = applyEvent(s, ev('message.part.updated', {
    part: {
      type: 'text', messageID: 'm', id: 'cc1', synthetic: true,
      metadata: { compaction_continue: true },
      text: "The previous request exceeded the provider's size limit due to large media attachments.",
    },
  }));
  const msg = s.messages.find((x) => x.role === 'assistant')!;
  const t = msg.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('');
  expect(t).toContain('✂ anexo grande removido');
  expect(t).not.toContain("provider's size limit");
});

test('Item 5 — part subtask vira kind:fork (sub-agente disparado fica visível)', () => {
  let s = applyEvent(emptyChat, ev('message.updated', { info: { id: 'm', role: 'assistant' } }));
  s = applyEvent(s, ev('message.part.updated', {
    part: { type: 'subtask', messageID: 'm', id: 'sub1', agent: 'explore', description: 'varrer o core', prompt: 'x' },
  }));
  const msg = s.messages.find((x) => x.role === 'assistant')!;
  const fork = msg.parts.find((p) => p.kind === 'fork');
  expect(fork).toBeTruthy();
  expect(fork!.fork).toEqual({ agent: 'explore', description: 'varrer o core' });
});

test('Item 6 — reconcile(null) = no-op (fetch falhou não apaga o modal); [] ainda remove', () => {
  const asked = applyEvent(
    emptyChat,
    ev('permission.asked', { id: 'p1', sessionID: 's', permission: 'bash', metadata: { command: 'git push' } }),
  );
  expect(asked.permissions).toHaveLength(1);
  // fetch falhou (null) → mantém a fila intacta (mesma referência)
  expect(reconcilePendingPermissions(asked, null)).toBe(asked);
  expect(reconcilePendingQuestions(asked, null)).toBe(asked);
  // server respondeu vazio de verdade ([]) → remove (comportamento antigo preservado)
  expect(reconcilePendingPermissions(asked, []).permissions).toHaveLength(0);
});

test('stripReasoningTags: tira <think> fechado, tag aberta sem fechar, e vários pares', () => {
  expect(stripReasoningTags('antes<think>raciocínio</think>depois')).toBe('antesdepois');
  expect(stripReasoningTags('resposta<think>pensando sem fim')).toBe('resposta'); // aberto sem fechar
  expect(stripReasoningTags('a<thinking>x</thinking>b◁think▷y◁/think▷c')).toBe('abc');
  expect(stripReasoningTags('sem tag nenhuma')).toBe('sem tag nenhuma'); // no-op
});

test('shouldCompact: dispara ao cruzar o teto menos a folga; ignora casos degenerados', () => {
  const ctx = 65536;
  const reserved = 8000; // teto efetivo = 57536
  expect(shouldCompact(57535, ctx, reserved)).toBe(false); // 1 abaixo
  expect(shouldCompact(57536, ctx, reserved)).toBe(true); // exatamente no teto efetivo
  expect(shouldCompact(60000, ctx, reserved)).toBe(true); // acima
  expect(shouldCompact(1000, ctx, reserved)).toBe(false); // bem abaixo
  expect(shouldCompact(60000, 0, reserved)).toBe(false); // contexto inválido → nunca
  expect(shouldCompact(0, ctx, reserved)).toBe(false); // sem tokens → nunca
});

test('computePart: <think> inline num part de texto NÃO chega ao output (Item 1)', () => {
  let s = applyEvent(emptyChat, ev('message.updated', { info: { id: 'm', role: 'assistant' } }));
  s = applyEvent(s, ev('message.part.updated', {
    part: { type: 'text', messageID: 'm', id: 't1', text: '<think>oculto</think>Resposta final' },
  }));
  const msg = s.messages.find((x) => x.role === 'assistant')!;
  const text = msg.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('');
  expect(text).toBe('Resposta final');
  expect(text).not.toContain('oculto');
});

test('part type:compaction NÃO vira texto no output (não vaza o resumo interno)', () => {
  let s = applyEvent(emptyChat, ev('message.updated', { info: { id: 'm', role: 'assistant' } }));
  s = applyEvent(s, ev('message.part.updated', {
    part: { type: 'compaction', messageID: 'm', id: 'c1', text: 'RESUMO INTERNO que não deve aparecer' },
  }));
  const msg = s.messages.find((x) => x.role === 'assistant')!;
  expect(msg.parts.some((p) => p.kind === 'text')).toBe(false);
  expect(JSON.stringify(msg.parts)).not.toContain('RESUMO INTERNO');
});

test('Task 2 — contextUsage: input de pico + output somado do último turno', () => {
  const step = (id: string, input: number, output: number): ChatMessage['parts'][number] => ({
    id, kind: 'step', text: '', step: { tokensIn: input, tokensOut: output, cost: 0 },
  });
  const messages: ChatMessage[] = [
    { id: 'a1', role: 'assistant', parts: [step('s1', 5000, 999)] }, // turno antigo — ignorado
    { id: 'u1', role: 'user', parts: [{ id: 'p', kind: 'text', text: 'oi' }] },
    { id: 'a2', role: 'assistant', parts: [step('s2', 20000, 100), step('s3', 31000, 400)] }, // último turno
  ];
  // input = MAIOR tokensIn do último turno (31000, não a soma 51000); output = SOMA (500).
  expect(contextUsage(messages)).toEqual({ tokensIn: 31000, tokensOut: 500 });
  // sem turno com uso → {0,0}.
  expect(contextUsage([{ id: 'u', role: 'user', parts: [{ id: 'p', kind: 'text', text: 'oi' }] }])).toEqual({ tokensIn: 0, tokensOut: 0 });
  expect(contextUsage([])).toEqual({ tokensIn: 0, tokensOut: 0 });
});

test('Sprint 2 — summarizeToolInput pega o campo mais útil', () => {
  expect(summarizeToolInput({ filePath: 'x.ts', extra: 1 })).toBe('x.ts');
  expect(summarizeToolInput({ command: 'bun test' })).toBe('bun test');
  expect(summarizeToolInput({ pattern: 'TODO', path: 'src' })).toBe('TODO'); // pattern (grep) antes de path
  expect(summarizeToolInput({ foo: 'bar' })).toBe('bar');
  expect(summarizeToolInput(undefined)).toBe('');
});

test('permission.updated → entra na fila; replied remove por id (Sprint 7.1)', () => {
  let s = applyEvent(emptyChat, ev('permission.updated', {
    id: 'perm_1', sessionID: 'ses_1', title: 'rodar bash `rm`', type: 'bash', patterns: ['rm -rf x'],
  }));
  expect(s.permissions).toHaveLength(1);
  expect(s.permissions[0]).toMatchObject({ id: 'perm_1', sessionId: 'ses_1', kind: 'bash', patterns: ['rm -rf x'] });
  s = applyEvent(s, ev('permission.replied', { sessionID: 'ses_1', permissionID: 'perm_1', response: 'reject' }));
  expect(s.permissions).toEqual([]);
});

test('permission.asked — kind, patterns, command (metadata) e always', () => {
  const s = applyEvent(emptyChat, ev('permission.asked', {
    id: 'per_x', sessionID: 'ses_2', permission: 'read', patterns: ['proj/.env'], always: ['*'],
  }));
  expect(s.permissions[0]).toMatchObject({
    id: 'per_x', sessionId: 'ses_2', kind: 'read', patterns: ['proj/.env'], always: ['*'],
  });

  const b = applyEvent(emptyChat, ev('permission.asked', {
    id: 'per_b', sessionID: 'ses_2', permission: 'bash',
    patterns: ['find src', 'sort'], always: ['find *', 'sort *'],
    metadata: { command: 'find src | sort' },
  }));
  expect(b.permissions[0].command).toBe('find src | sort');
});

test('reconcilePendingPermissions — recupera permissão perdida (sub-agente) e tira as que sumiram', () => {
  // a TUI não viu o `permission.asked` (veio de um sub-agente `task`) → fila vazia,
  // mas o `GET /permission` mostra 2 pendentes.
  const live = [
    { id: 'per_sub1', sessionID: 'ses_child', permission: 'bash', patterns: ['ls -la'], metadata: { command: 'cd x && ls -la' } },
    { id: 'per_sub2', sessionID: 'ses_child', permission: 'bash', patterns: ['git log'] },
  ];
  let s = reconcilePendingPermissions(emptyChat, live);
  expect(s.permissions.map((p) => p.id)).toEqual(['per_sub1', 'per_sub2']);
  expect(s.permissions[0]).toMatchObject({ sessionId: 'ses_child', kind: 'bash', command: 'cd x && ls -la' });

  // já tinha uma na fila (per_a) que o server não lista mais (respondida noutro lugar) → sai
  s = { ...s, permissions: [{ id: 'per_a', sessionId: 's', kind: 'bash', patterns: [], always: [], title: 'shell' }, ...s.permissions] };
  s = reconcilePendingPermissions(s, live);
  expect(s.permissions.map((p) => p.id)).toEqual(['per_sub1', 'per_sub2']);

  // idempotente: mesma lista → mesma referência (sem re-render à toa)
  expect(reconcilePendingPermissions(s, live)).toBe(s);
});

test('BATCH PARALELO — 3 permission.asked = 3 na fila (não sobrescreve); responder faz shift', () => {
  let s = emptyChat;
  for (const id of ['p1', 'p2', 'p3']) {
    s = applyEvent(s, ev('permission.asked', { id, sessionID: 's', permission: 'bash', patterns: [`cmd ${id}`] }));
  }
  expect(s.permissions.map((x) => x.id)).toEqual(['p1', 'p2', 'p3']);
  // evento repetido do mesmo id → não duplica
  s = applyEvent(s, ev('permission.asked', { id: 'p2', sessionID: 's', permission: 'bash', patterns: ['x'] }));
  expect(s.permissions).toHaveLength(3);
  // responde o p1 (via replied vindo do server)
  s = applyEvent(s, ev('permission.replied', { permissionID: 'p1', response: 'once' }));
  expect(s.permissions.map((x) => x.id)).toEqual(['p2', 'p3']);
});

test('tool question — question.asked entra na fila estruturada; replied remove por requestID', () => {
  let s = applyEvent(emptyChat, ev('question.asked', {
    requestID: 'q1', sessionID: 'ses_1',
    questions: [{ question: 'Qual passo?', header: 'Próximo', options: [{ label: 'Plan', description: 'd' }, { label: 'Review' }] }],
  }));
  expect(s.questions).toHaveLength(1);
  expect(s.questions[0]).toMatchObject({ id: 'q1', sessionId: 'ses_1' });
  expect(s.questions[0].questions[0].question).toBe('Qual passo?');
  expect(s.questions[0].questions[0].options.map((o) => o.label)).toEqual(['Plan', 'Review']);
  // evento repetido do mesmo id → não duplica
  s = applyEvent(s, ev('question.updated', { requestID: 'q1', sessionID: 'ses_1', questions: [] }));
  expect(s.questions).toHaveLength(1);
  // replied remove por requestID
  s = applyEvent(s, ev('question.replied', { requestID: 'q1', sessionID: 'ses_1' }));
  expect(s.questions).toEqual([]);
});

test('reconcilePendingQuestions — recupera a perdida e tira as que sumiram; idempotente', () => {
  const live = [{ requestID: 'qa', sessionID: 's', questions: [{ question: 'x?', options: [{ label: 'y' }] }] }];
  const s = reconcilePendingQuestions(emptyChat, live);
  expect(s.questions.map((q) => q.id)).toEqual(['qa']);
  expect(reconcilePendingQuestions(s, live)).toBe(s); // idempotente
  expect(reconcilePendingQuestions(s, []).questions).toEqual([]); // sumiu do server → sai
});

test('looksLikeScaffolding — detecta o bloco work-state (≥3 headers), ignora prosa normal', () => {
  const block = '## Objective\n- listar tools\n\n## Work State\nCompleted\n- feito\n\n## Next Move\n1. aguardar';
  expect(looksLikeScaffolding(block)).toBe(true);
  expect(looksLikeScaffolding('Aqui está a resposta: os arquivos foram criados com sucesso.')).toBe(false);
  expect(looksLikeScaffolding('## Objective\nsó um header, não é scaffolding')).toBe(false); // <3
});

test('isInternalMessage — flag mode:compaction/summary OU texto-scaffolding; resposta normal = false', () => {
  const scaffold: ChatMessage = {
    id: 'a', role: 'assistant',
    parts: [{ id: 't', kind: 'text', text: '## Objective\nx\n## Work State\ny\n## Next Move\nz' }],
  };
  expect(isInternalMessage(scaffold)).toBe(true);
  const compact: ChatMessage = { id: 'b', role: 'assistant', mode: 'compaction', parts: [{ id: 't', kind: 'text', text: 'resumo' }] };
  expect(isInternalMessage(compact)).toBe(true);
  const summary: ChatMessage = { id: 'c', role: 'assistant', summary: true, parts: [] };
  expect(isInternalMessage(summary)).toBe(true);
  const normal: ChatMessage = { id: 'd', role: 'assistant', parts: [{ id: 't', kind: 'text', text: 'resposta normal ao usuário' }] };
  expect(isInternalMessage(normal)).toBe(false);
});

test('message.updated captura mode:compaction/summary na mensagem (→ ofuscada)', () => {
  const s = applyEvent(emptyChat, ev('message.updated', { info: { id: 'm', role: 'assistant', mode: 'compaction', summary: true } }));
  const m = s.messages.find((x) => x.id === 'm')!;
  expect(m.mode).toBe('compaction');
  expect(m.summary).toBe(true);
  expect(isInternalMessage(m)).toBe(true);
});

test('session.status idle também limpa busy', () => {
  const s = applyEvent({ ...emptyChat, busy: true }, ev('session.status', { status: { type: 'idle' } }));
  expect(s.busy).toBe(false);
});

test('Sprint 7.3 — session.error: ProviderAuthError vira bloco com dica; abort não mostra nada', () => {
  let s = applyEvent({ ...emptyChat, busy: true }, ev('session.error', {
    error: { name: 'ProviderAuthError', data: { providerID: 'opencode', message: 'token expired' } },
  }));
  expect(s.busy).toBe(false);
  expect(s.error).toEqual({
    name: 'ProviderAuthError',
    message: 'credencial do provedor inválida — rode `opencode auth login`',
    retryable: false,
  });

  // APIError retryable
  s = applyEvent(emptyChat, ev('session.error', {
    error: { name: 'APIError', data: { message: '503 upstream', isRetryable: true } },
  }));
  expect(s.error).toEqual({ name: 'APIError', message: '503 upstream', retryable: true });

  // MessageAbortedError (usuário apertou Esc) → não vira erro
  s = applyEvent({ ...emptyChat, busy: true }, ev('session.error', {
    error: { name: 'MessageAbortedError', data: { message: 'Aborted' } },
  }));
  expect(s.error).toBeNull();
  expect(s.busy).toBe(false);

  // novo prompt limpa o erro
  const withErr = { ...emptyChat, error: { name: 'APIError', message: 'x', retryable: true } };
  expect(pushUserMessage(withErr, 'de novo').error).toBeNull();
});

test('Sprint 7.4 — pendingQuestion: assistant termina com "?" e parou → devolve a pergunta', () => {
  const asst = (text: string): ChatMessage => ({ id: 'a', role: 'assistant', parts: [{ id: 't', kind: 'text', text }] });

  const q = { ...emptyChat, busy: false, messages: [asst('Fiz X e Y.\nQuer que eu rode os testes agora?')] };
  expect(pendingQuestion(q)).toBe('Quer que eu rode os testes agora?');

  // sem "?" → null
  expect(pendingQuestion({ ...emptyChat, messages: [asst('Pronto, tudo verde.')] })).toBeNull();
  // ainda processando → null
  expect(pendingQuestion({ ...q, busy: true })).toBeNull();
  // tem permissão na fila → null (a permissão vem primeiro)
  expect(pendingQuestion({ ...q, permissions: [{ id: 'p', sessionId: 's', kind: 'bash', patterns: [], always: [], title: '' }] })).toBeNull();
  // última msg é do user → null
  expect(pendingQuestion({ ...emptyChat, messages: [asst('e aí?'), { id: 'u', role: 'user', parts: [{ id: 'x', kind: 'text', text: 'sim' }] }] })).toBeNull();
  // "?" só dentro de bloco de código não conta
  expect(pendingQuestion({ ...emptyChat, messages: [asst('rode isto:\n```\necho "ok?"\n```')] })).toBeNull();
});

test('Sprint 7.3 — session.compacted e installation.update-available viram toast', () => {
  expect(applyEvent(emptyChat, ev('session.compacted', { sessionID: 's' })).toasts[0].message).toContain('compactado');
  expect(applyEvent(emptyChat, ev('installation.update-available', { version: '1.19.0' })).toasts[0].message).toContain('1.19.0');
});

test('Sprint 7.6 — questionOptions: parseia menu numerado/marcado; < 2 → []', () => {
  const asst = (text: string): ChatMessage => ({ id: 'a', role: 'assistant', parts: [{ id: 't', kind: 'text', text }] });

  const s = {
    ...emptyChat,
    messages: [asst('Por onde começo?\n1. Pelo core\n2) Pelos adapters\n3. Pelos testes')],
  };
  expect(questionOptions(s)).toEqual(['Pelo core', 'Pelos adapters', 'Pelos testes']);

  // checkbox e letras
  expect(questionOptions({ ...emptyChat, messages: [asst('Escolha:\n- [ ] opção A\n- [ ] opção B\n?')] })).toEqual(['opção A', 'opção B']);

  // só 1 item → não é menu
  expect(questionOptions({ ...emptyChat, messages: [asst('Faço assim?\n1. sim')] })).toEqual([]);
  // sem pergunta → []
  expect(questionOptions({ ...emptyChat, messages: [asst('Feito:\n1. core\n2. adapters')] })).toEqual([]);
  // dentro de código não conta
  expect(questionOptions({ ...emptyChat, messages: [asst('rode?\n```\n1. x\n2. y\n```') ] })).toEqual([]);
});

test('Sprint 7.8 — session.diff vira o resumo de arquivos +/−; prompt limpa', () => {
  const s = applyEvent(emptyChat, ev('session.diff', {
    sessionID: 's',
    diff: [
      { file: 'src/a.ts', additions: 12, deletions: 3, before: '', after: '' },
      { file: 'src/b.ts', additions: 5, deletions: 0, before: '', after: '' },
    ],
  }));
  expect(s.diff).toEqual([
    { file: 'src/a.ts', added: 12, removed: 3 },
    { file: 'src/b.ts', added: 5, removed: 0 },
  ]);
  expect(pushUserMessage(s, 'próximo').diff).toEqual([]);
});

test('Sprint 7.2 — tui.toast.show vira um toast (variant + message + teto de 5)', () => {
  let s = applyEvent(emptyChat, ev('tui.toast.show', { title: 'Deploy', message: 'ok!', variant: 'success', duration: 9999 }));
  expect(s.toasts).toHaveLength(1);
  expect(s.toasts[0]).toMatchObject({ message: 'Deploy — ok!', variant: 'success' });
  expect(s.toasts[0].until).toBeGreaterThan(Date.now());

  // variant inválido → 'info'; teto de 5
  for (let i = 0; i < 8; i++) s = applyEvent(s, ev('tui.toast.show', { message: `m${i}`, variant: 'xxx' }));
  expect(s.toasts.length).toBeLessThanOrEqual(5);
  expect(s.toasts.at(-1)).toMatchObject({ message: 'm7', variant: 'info' });
});

test('ACEITE: estouro de contexto é normalizado, mesmo chegando como APIError cru', () => {
  // O caso real veio como a mensagem crua do vLLM. Sem normalizar aqui, a TUI mostrava
  // "erro no motor" e ninguém disparava a recuperação — a sessão morria de vez.
  const cru =
    "This model's maximum context length is 98304 tokens. However, you requested 2048 " +
    'output tokens and your prompt contains at least 96257 input tokens';
  const s = applyEvent(
    { ...emptyChat, busy: true },
    ev('session.error', { error: { name: 'APIError', data: { message: cru } } }),
  );

  expect(s.error?.name).toBe('ContextOverflowError'); // é o que dispara a recuperação
  expect(s.error?.message).toContain('janela de contexto estourou');
  expect(s.busy).toBe(false);
});

test('estouro nomeado pelo motor também é reconhecido', () => {
  const s = applyEvent(
    emptyChat,
    ev('session.error', { error: { name: 'ContextOverflowError', data: { message: 'x' } } }),
  );
  expect(s.error?.name).toBe('ContextOverflowError');
});

test('APIError comum não vira estouro (a recuperação não pode disparar à toa)', () => {
  const s = applyEvent(
    emptyChat,
    ev('session.error', { error: { name: 'APIError', data: { message: 'connection reset' } } }),
  );
  expect(s.error?.name).toBe('APIError');
});

test('ACEITE: custom:true chega ao estado — é a saída pra opção que não cobre o caso', () => {
  // Sem isto, uma pergunta mal formulada prende o usuário nas opções oferecidas.
  const s = applyEvent(emptyChat, ev('question.asked', {
    requestID: 'req_1', sessionID: 'ses_1',
    questions: [{ question: 'Qual dataset?', custom: true, options: [{ label: 'COMERCIAL' }] }],
  }));
  expect(s.questions[0]!.questions[0]!.custom).toBe(true);
});

test('pergunta sem custom não vira campo livre por acidente', () => {
  const s = applyEvent(emptyChat, ev('question.asked', {
    requestID: 'req_2', sessionID: 'ses_1',
    questions: [{ question: 'Apagar?', options: [{ label: 'sim' }, { label: 'não' }] }],
  }));
  expect(s.questions[0]!.questions[0]!.custom).toBe(false);
});

test('question.rejected tira a pergunta da fila (antes ficava órfã)', () => {
  let s = applyEvent(emptyChat, ev('question.asked', {
    requestID: 'req_3', sessionID: 'ses_1',
    questions: [{ question: 'x', options: [{ label: 'a' }] }],
  }));
  expect(s.questions).toHaveLength(1);
  s = applyEvent(s, ev('question.rejected', { requestID: 'req_3' }));
  expect(s.questions).toHaveLength(0);
});

test('família question.v2.* é tratada igual à v1 (o motor emite qualquer uma)', () => {
  let s = applyEvent(emptyChat, ev('question.v2.asked', {
    requestID: 'req_4', sessionID: 'ses_1',
    questions: [{ question: 'Qual período?', multiple: true, options: [{ label: '2025' }, { label: '2026' }] }],
  }));
  expect(s.questions).toHaveLength(1);
  expect(s.questions[0]!.questions[0]!.multi).toBe(true);

  s = applyEvent(s, ev('question.v2.replied', { requestID: 'req_4' }));
  expect(s.questions).toHaveLength(0);
});

test('ACEITE: compactação pedida pela TUI não é abortada (bug de prod)', () => {
  // A proativa roda com a sessão OCIOSA — userTurnActive falso é a condição normal
  // dela, não sinal de emenda intrusa. Abortar aqui impedia qualquer compactação.
  expect(shouldAbortCompaction({ userTurnActive: false, requestedByTui: true })).toBe(false);
});

test('emenda que ninguém pediu continua sendo abortada', () => {
  expect(shouldAbortCompaction({ userTurnActive: false, requestedByTui: false })).toBe(true);
});

test('turno do usuário em curso nunca é morto, venha o que vier', () => {
  expect(shouldAbortCompaction({ userTurnActive: true, requestedByTui: false })).toBe(false);
  expect(shouldAbortCompaction({ userTurnActive: true, requestedByTui: true })).toBe(false);
});

const toolPart = (name: string, status: string, input: Record<string, unknown>, output = '') =>
  ({ id: `t-${name}-${status}`, kind: 'tool' as const, text: name, tool: { name, status, input, output } });
const reasoningPart = (t: string) => ({ id: `r-${t.slice(0, 5)}`, kind: 'reasoning' as const, text: t });

test('ACEITE: o raciocínio atribuído é o ANTERIOR à chamada (a causa, não a consequência)', () => {
  const msgs = [{
    id: 'm1', role: 'assistant' as const,
    parts: [
      reasoningPart('vou supor que a tabela é VENDAS'),
      toolPart('nio_fabric_query', 'error', { dax: 'a' }, 'Cannot find table'),
      reasoningPart('agora entendi, é VISAO_COMERCIAL'),
      toolPart('nio_fabric_query', 'completed', { dax: 'b' }),
    ],
  }];
  const attempts = toolAttempts(msgs);

  expect(attempts).toHaveLength(2);
  expect(attempts[0]!.reasoning).toBe('vou supor que a tabela é VENDAS'); // causa do erro
  expect(attempts[1]!.reasoning).toBe('agora entendi, é VISAO_COMERCIAL');
});

test('raciocínio não vaza para a chamada seguinte quando não há um novo', () => {
  const msgs = [{
    id: 'm1', role: 'assistant' as const,
    parts: [reasoningPart('pensei uma vez'), toolPart('a', 'completed', {}), toolPart('b', 'completed', {})],
  }];
  const attempts = toolAttempts(msgs);
  expect(attempts[0]!.reasoning).toBe('pensei uma vez');
  expect(attempts[1]!.reasoning).toBeUndefined();
});

test('failedTools lista só o que realmente falhou nesta sessão', () => {
  const msgs = [{
    id: 'm1', role: 'assistant' as const,
    parts: [toolPart('bash', 'error', {}, 'x'), toolPart('read', 'completed', {}), toolPart('bash', 'error', {}, 'y')],
  }];
  expect(failedTools(msgs)).toEqual(['bash']);
});

test('histórico sem tool nenhuma → nada a aprender', () => {
  expect(toolAttempts([{ id: 'm', role: 'assistant', parts: [reasoningPart('só pensei')] }])).toEqual([]);
});

test('ACEITE: request em voo nunca é morta, mesmo sem turno marcado como ativo', () => {
  // A regra que o dono pediu: enquanto houver o que processar com retorno pendente,
  // a request não pode morrer. `userTurnActive` sozinho não cobre — ele é zerado no
  // primeiro `idle`, que pode chegar entre passos de um turno agêntico.
  expect(
    shouldAbortCompaction({ userTurnActive: false, requestedByTui: false, workInFlight: true }),
  ).toBe(false);
});

test('sem nada em voo e sem pedido, a emenda intrusa segue sendo abortada', () => {
  expect(
    shouldAbortCompaction({ userTurnActive: false, requestedByTui: false, workInFlight: false }),
  ).toBe(true);
});
