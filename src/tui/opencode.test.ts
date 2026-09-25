import { test, expect, afterEach } from 'bun:test';
import { fetchPendingQuestions, fetchPendingPermissions } from './opencode.js';

const BASE = 'http://127.0.0.1:4096';
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

/** Servidor falso que responde JSON só na rota certa — e HTML no resto, como o opencode. */
function fakeServer(rotaValida: string, corpo: unknown) {
  const chamadas: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    chamadas.push(url.pathname);
    if (url.pathname === rotaValida) {
      return new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // O opencode serve o web UI em rota desconhecida — não dá 404.
    return new Response('<!doctype html><html>…</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  return chamadas;
}

test('ACEITE: a consulta bate em /question — a rota por sessão não existe', () => {
  // Bug de prod: `/session/:id/question` devolve o HTML do web UI, o JSON.parse estoura,
  // e a reconciliação nunca recuperava uma pergunta cujo evento SSE se perdeu.
  const chamadas = fakeServer('/question', [{ requestID: 'q1', sessionID: 's1', questions: [] }]);
  return fetchPendingQuestions(BASE).then((r) => {
    expect(chamadas).toEqual(['/question']);
    expect(r).toHaveLength(1);
  });
});

test('ACEITE: resposta HTML vira null, não lista vazia', async () => {
  // `null` = "não sei" → mantém a fila. `[]` significaria "não há nada" e apagaria o
  // modal que o usuário está vendo.
  fakeServer('/rota-que-nao-existe', []);
  expect(await fetchPendingQuestions(BASE)).toBeNull();
});

test('pergunta de sub-agente NÃO é descartada por vir de outra sessão', async () => {
  // O reply vai na sessão que a pergunta carrega; filtrar aqui perderia a do sub-agente.
  fakeServer('/question', [
    { requestID: 'q1', sessionID: 'ses_principal', questions: [] },
    { requestID: 'q2', sessionID: 'ses_subagente', questions: [] },
  ]);
  const r = await fetchPendingQuestions(BASE);
  expect(r).toHaveLength(2);
});

test('corpo que não é array vira null (não confia em resposta estranha)', async () => {
  fakeServer('/question', { erro: 'inesperado' });
  expect(await fetchPendingQuestions(BASE)).toBeNull();
});

test('rede fora → null, para a fila não ser apagada', async () => {
  globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
  expect(await fetchPendingQuestions(BASE)).toBeNull();
});

test('permissões continuam em /permission (não regredimos a que já funcionava)', async () => {
  const chamadas = fakeServer('/permission', [{ id: 'p1', sessionID: 's1' }]);
  await fetchPendingPermissions(BASE);
  expect(chamadas).toEqual(['/permission']);
});
