/**
 * Cada teste aqui corresponde a uma armadilha real do stream do opencode. Se um
 * deles for "simplificado", o executor volta a travar em silêncio — que é o
 * modo de falha mais caro do sistema (headless, ninguém vê).
 */
import { test, expect } from 'bun:test';
import {
  createStepAccumulator,
  engineErrorFrom,
  eventSessionId,
  isTurnEnd,
  permissionFrom,
  questionFrom,
} from './step-events.js';

const evt = (type: string, properties: Record<string, unknown> = {}): unknown => ({
  type,
  properties,
});

test('fim de turno: as DUAS formas que o motor emite', () => {
  expect(isTurnEnd(evt('session.idle'))).toBe(true);
  expect(isTurnEnd(evt('session.status', { status: { type: 'idle' } }))).toBe(true);
  // `session.status` com outro type não fecha o turno — fechar aqui cortaria o step no meio.
  expect(isTurnEnd(evt('session.status', { status: { type: 'retry' } }))).toBe(false);
  expect(isTurnEnd(evt('message.part.updated'))).toBe(false);
});

test('permissão: `asked` é o que o motor manda, `updated` é o que o SDK tipa', () => {
  const asked = permissionFrom(
    evt('permission.asked', { id: 'p1', sessionID: 's1', tool: { name: 'bash' } }),
  );
  expect(asked).toEqual({ id: 'p1', sessionId: 's1', subject: 'bash' });

  // Tratar só um dos dois deixaria o turno preso para sempre.
  expect(permissionFrom(evt('permission.updated', { id: 'p2', sessionID: 's1' }))).not.toBeNull();
  expect(permissionFrom(evt('permission.replied', { id: 'p1', sessionID: 's1' }))).toBeNull();
  // Sem id ou sem sessão não dá pra responder — ignorar é melhor que responder errado.
  expect(permissionFrom(evt('permission.asked', { id: 'p3' }))).toBeNull();
});

test('pergunta: família normal e a paralela `question.v2.*`', () => {
  expect(
    questionFrom(evt('question.asked', { id: 'q1', sessionID: 's1', title: 'qual banco?' })),
  ).toEqual({ id: 'q1', sessionId: 's1', subject: 'qual banco?' });
  // O motor escolhe qual família emitir; perder a v2 trava o turno igual.
  expect(questionFrom(evt('question.v2.asked', { id: 'q2', sessionID: 's1' }))).not.toBeNull();
  expect(questionFrom(evt('question.replied', { id: 'q1', sessionID: 's1' }))).toBeNull();
});

test('sessionID é achado nos três lugares onde o motor o põe', () => {
  expect(eventSessionId(evt('x', { sessionID: 's1' }))).toBe('s1');
  expect(eventSessionId(evt('x', { part: { sessionID: 's2' } }))).toBe('s2');
  expect(eventSessionId(evt('x', { info: { sessionID: 's3' } }))).toBe('s3');
  expect(eventSessionId(evt('x', {}))).toBeUndefined();
});

test('acumulador: part é SNAPSHOT, não delta — sobrescreve, não concatena', () => {
  const acc = createStepAccumulator();
  acc.apply(evt('message.part.updated', { part: { id: 't1', type: 'text', text: 'Olá' } }));
  acc.apply(evt('message.part.updated', { part: { id: 't1', type: 'text', text: 'Olá mundo' } }));
  // Concatenar daria "OláOlá mundo" — é o bug clássico deste stream.
  expect(acc.result().text).toBe('Olá mundo');
});

test('acumulador: tools viram trilha com o último status de cada uma', () => {
  const acc = createStepAccumulator();
  acc.apply(
    evt('message.part.updated', {
      part: { id: 'a', type: 'tool', tool: 'read', state: { status: 'running' } },
    }),
  );
  acc.apply(
    evt('message.part.updated', {
      part: { id: 'a', type: 'tool', tool: 'read', state: { status: 'completed' } },
    }),
  );
  acc.apply(
    evt('message.part.updated', {
      part: { id: 'b', type: 'tool', tool: 'grep', state: { status: 'error' } },
    }),
  );

  const { toolCalls } = acc.result();
  expect(toolCalls).toHaveLength(2);
  expect(toolCalls[0]).toEqual({ tool: 'read', status: 'completed' });
  expect(toolCalls[1]).toEqual({ tool: 'grep', status: 'error' });
});

test('acumulador: tokens somam entre passos agênticos', () => {
  const acc = createStepAccumulator();
  acc.apply(
    evt('message.part.updated', {
      part: { id: 's1', type: 'step-finish', tokens: { input: 100, output: 20 } },
    }),
  );
  acc.apply(
    evt('message.part.updated', {
      part: { id: 's2', type: 'step-finish', tokens: { input: 50, output: 10 } },
    }),
  );
  expect(acc.result()).toMatchObject({ tokensIn: 150, tokensOut: 30 });
});

test('acumulador ignora o que não é message.part.updated', () => {
  const acc = createStepAccumulator();
  acc.apply(evt('session.idle'));
  acc.apply(evt('message.part.delta', { part: { id: 'x', type: 'text', text: 'ruído' } }));
  expect(acc.result().text).toBe('');
});

test('engineErrorFrom: ContextOverflowError nomeado pelo motor', () => {
  const e = engineErrorFrom(evt('session.error', { error: { name: 'ContextOverflowError' } }));
  expect(e?.kind).toBe('context_overflow');
});

test('engineErrorFrom: estouro sem nome, só a mensagem crua do provider', () => {
  // O motor nem sempre nomeia — às vezes só devolve APIError com a frase do provider.
  const e = engineErrorFrom(
    evt('session.error', {
      error: {
        name: 'APIError',
        data: { message: "This model's maximum context length is 32000 tokens" },
      },
    }),
  );
  expect(e?.kind).toBe('context_overflow');
});

test('engineErrorFrom: MessageOutputLengthError pede continuação, não sessão nova', () => {
  const e = engineErrorFrom(evt('session.error', { error: { name: 'MessageOutputLengthError' } }));
  expect(e?.kind).toBe('output_length');
});

test('engineErrorFrom: erro genérico do motor não tem recuperação automática', () => {
  const e = engineErrorFrom(evt('session.error', { error: { name: 'ProviderAuthError' } }));
  expect(e?.kind).toBe('other');
  expect(e?.name).toBe('ProviderAuthError');
});

test('engineErrorFrom: MessageAbortedError não é falha — foi um abort nosso', () => {
  // Sem isto, todo `session.abort()` que o próprio executor dispara (timeout,
  // fim do step) pareceria um erro do motor e tentaria "recuperar" à toa.
  expect(
    engineErrorFrom(evt('session.error', { error: { name: 'MessageAbortedError' } })),
  ).toBeNull();
});

test('engineErrorFrom: ignora evento sem error e evento de outro tipo', () => {
  expect(engineErrorFrom(evt('session.error', {}))).toBeNull();
  expect(
    engineErrorFrom(evt('message.part.updated', { error: { name: 'ContextOverflowError' } })),
  ).toBeNull();
});
