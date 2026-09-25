import { test, expect } from 'bun:test';
import { warmPrefixCache, eventSessionId } from './warmup.js';
import type { OpencodeClient } from '@opencode-ai/sdk';

const MODEL = { providerID: 'nio-local', modelID: 'q' };

interface Espiao {
  criadas: number;
  prompts: unknown[];
  apagadas: string[];
}

function fakeClient(over: { falhaNoPrompt?: boolean; semId?: boolean } = {}): {
  client: OpencodeClient;
  espiao: Espiao;
} {
  const espiao: Espiao = { criadas: 0, prompts: [], apagadas: [] };
  const client = {
    session: {
      create: async () => {
        espiao.criadas += 1;
        return { data: over.semId ? {} : { id: 'ses_warm' } };
      },
      prompt: async (args: unknown) => {
        if (over.falhaNoPrompt) throw new Error('backend fora');
        espiao.prompts.push(args);
        return { data: { parts: [] } };
      },
      delete: async ({ path }: { path: { id: string } }) => {
        espiao.apagadas.push(path.id);
        return { data: true };
      },
    },
  } as unknown as OpencodeClient;
  return { client, espiao };
}

test('ACEITE: aquece e APAGA a sessão (senão vira lixo no histórico do usuário)', async () => {
  const { client, espiao } = fakeClient();
  const ok = await warmPrefixCache({ client, model: MODEL, agent: 'build' });

  expect(ok).toBe(true);
  expect(espiao.criadas).toBe(1);
  expect(espiao.prompts).toHaveLength(1);
  expect(espiao.apagadas).toEqual(['ses_warm']);
});

test('ACEITE: o id da sessão é avisado ANTES da resposta (a TUI filtra os eventos por ele)', async () => {
  // Sem isto os eventos do aquecimento cairiam no chat: `applyEvent` não filtra sessão.
  const { client } = fakeClient();
  const vistos: string[] = [];
  await warmPrefixCache({ client, model: MODEL, agent: 'build', onSession: (id) => vistos.push(id) });
  expect(vistos).toEqual(['ses_warm']);
});

test('usa o MESMO modelo e agente da sessão real (prefixo diferente não aquece nada)', async () => {
  const { client, espiao } = fakeClient();
  await warmPrefixCache({ client, model: MODEL, agent: 'plan' });
  const body = (espiao.prompts[0] as { body: { model: unknown; agent: string } }).body;
  expect(body.model).toEqual(MODEL);
  expect(body.agent).toBe('plan');
});

test('falha do backend não propaga — é otimização, não funcionalidade', async () => {
  const { client, espiao } = fakeClient({ falhaNoPrompt: true });
  const ok = await warmPrefixCache({ client, model: MODEL, agent: 'build' });

  expect(ok).toBe(false);
  expect(espiao.apagadas).toEqual(['ses_warm']); // mesmo falhando, não deixa sessão órfã
});

test('sessão sem id → desiste sem tentar prompt nem delete', async () => {
  const { client, espiao } = fakeClient({ semId: true });
  expect(await warmPrefixCache({ client, model: MODEL, agent: 'build' })).toBe(false);
  expect(espiao.prompts).toHaveLength(0);
  expect(espiao.apagadas).toHaveLength(0);
});

test('eventSessionId acha o id no topo ou dentro de info', () => {
  expect(eventSessionId({ sessionID: 'a' })).toBe('a');
  expect(eventSessionId({ info: { sessionID: 'b' } })).toBe('b');
  expect(eventSessionId({})).toBe('');
  expect(eventSessionId({ sessionID: 42 })).toBe(''); // tipo errado não vira id
});
