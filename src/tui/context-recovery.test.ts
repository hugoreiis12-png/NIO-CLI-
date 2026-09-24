import { test, expect } from 'bun:test';
import { isContextOverflow, buildHandoffDigest, HANDOFF_MAX_CHARS } from './context-recovery.js';
import type { ChatMessage, ChatPart } from './state.js';

const texto = (t: string): ChatPart => ({ id: `p-${t.slice(0, 6)}`, kind: 'text', text: t });
const tool = (name: string): ChatPart => ({
  id: `t-${name}`,
  kind: 'tool',
  text: name,
  tool: { name, status: 'completed', output: 'x'.repeat(50_000) },
});

const msg = (role: 'user' | 'assistant', parts: ChatPart[], extra = {}): ChatMessage => ({
  id: Math.random().toString(36).slice(2),
  role,
  parts,
  ...extra,
});

test('reconhece o erro pelo nome', () => {
  expect(isContextOverflow('ContextOverflowError')).toBe(true);
});

test('reconhece pela mensagem do provider quando o nome é genérico', () => {
  // O caso real: chegou como APIError com a mensagem crua do vLLM.
  const m = "This model's maximum context length is 98304 tokens. However, you requested 2048 output tokens";
  expect(isContextOverflow('APIError', m)).toBe(true);
});

test('não confunde com outro erro', () => {
  expect(isContextOverflow('ProviderAuthError', 'invalid api key')).toBe(false);
  expect(isContextOverflow('APIError', 'connection reset')).toBe(false);
});

test('resumo traz as falas na ordem cronológica', () => {
  const digest = buildHandoffDigest([
    msg('user', [texto('preciso listar os workspaces')]),
    msg('assistant', [texto('encontrei 25 workspaces')]),
  ]);
  expect(digest.indexOf('preciso listar')).toBeLessThan(digest.indexOf('encontrei 25'));
  expect(digest).toContain('Você:');
  expect(digest).toContain('Eu:');
});

test('ACEITE: o resumo cabe na janela por construção, mesmo com tool gigante', () => {
  // É isto que quebrava o `summarize`: ele reenviava tudo, inclusive saídas de 50k.
  const messages = Array.from({ length: 200 }, (_, i) =>
    msg('assistant', [texto('resposta '.repeat(500)), tool(`tool_${i}`)]),
  );
  const digest = buildHandoffDigest(messages);
  expect(digest.length).toBeLessThanOrEqual(HANDOFF_MAX_CHARS + 500); // + o cabeçalho fixo
});

test('registra as tools usadas, não a saída delas', () => {
  const digest = buildHandoffDigest([msg('assistant', [texto('consultei'), tool('nio_fabric_query')])]);
  expect(digest).toContain('nio_fabric_query');
  expect(digest).not.toContain('xxxxx'); // a saída da tool não entra
});

test('prioriza o fim da conversa', () => {
  const messages = Array.from({ length: 60 }, (_, i) => msg('user', [texto(`turno ${i}`)]));
  const digest = buildHandoffDigest(messages);
  expect(digest).toContain('turno 59');
  expect(digest).not.toContain('turno 0\n');
});

test('descarta resumo do próprio opencode — resumir resumo ofuscado só degrada', () => {
  const digest = buildHandoffDigest([
    msg('assistant', [texto('RESUMO INTERNO')], { summary: true }),
    msg('user', [texto('pergunta real')]),
  ]);
  expect(digest).not.toContain('RESUMO INTERNO');
  expect(digest).toContain('pergunta real');
});

test('conversa vazia → string vazia (o chamador não semeia nada)', () => {
  expect(buildHandoffDigest([])).toBe('');
  expect(buildHandoffDigest([msg('user', [])])).toBe('');
});