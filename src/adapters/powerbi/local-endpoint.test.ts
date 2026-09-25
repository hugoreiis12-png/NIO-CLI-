import { test, expect } from 'bun:test';
import { parseTasklistPids, parseListeningPort, discoverLocalXmla } from './local-endpoint.js';

// Saídas REAIS capturadas na máquina (2026-09-25), não formato imaginado.
const TASKLIST_OK = '"msmdsrv.exe","15812","Console","1","123.456 K"';
const TASKLIST_VAZIO = 'INFORMAÇÕES: nenhuma tarefa em execução correspondente aos critérios\r\nespecificados.';
const NETSTAT = [
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1508',
  '  TCP    127.0.0.1:31272        0.0.0.0:0              LISTENING       15812',
  '  TCP    [::1]:31272            [::]:0                 LISTENING       15812',
  '  TCP    127.0.0.1:4096         0.0.0.0:0              LISTENING       38292',
].join('\r\n');

test('ACEITE: acha a porta efêmera real — o agente chutava 55100', () => {
  // Medido: Desktop aberto servindo em 127.0.0.1:31272, e nada na 55100. O agente
  // testou só a porta lembrada e concluiu que o modo local estava fora do ar.
  const pids = parseTasklistPids(TASKLIST_OK);
  expect(pids).toEqual([15812]);
  expect(parseListeningPort(NETSTAT, pids)).toBe(31272);
});

test('prefere IPv4 quando o processo escuta nos dois', () => {
  // `localhost` na string de conexão resolve pra IPv4 em cliente antigo; ::1 confunde.
  expect(parseListeningPort(NETSTAT, [15812])).toBe(31272);
});

test('só IPv6 disponível ainda serve', () => {
  const so6 = '  TCP    [::1]:5555            [::]:0                 LISTENING       99';
  expect(parseListeningPort(so6, [99])).toBe(5555);
});

test('porta de OUTRO processo não é confundida', () => {
  expect(parseListeningPort(NETSTAT, [38292])).toBe(4096); // o opencode serve
  expect(parseListeningPort(NETSTAT, [1])).toBeNull();
});

test('ACEITE: mensagem localizada de "nenhuma tarefa" não vira PID', () => {
  // Casar pelo nome da imagem, não pela ausência da mensagem: ela muda com o idioma
  // do Windows e vem em codepage legada.
  expect(parseTasklistPids(TASKLIST_VAZIO)).toEqual([]);
});

test('Desktop fechado → not_running com explicação, não erro genérico', async () => {
  const r = await discoverLocalXmla({ platform: 'win32', exec: async () => TASKLIST_VAZIO });
  expect(r.status).toBe('not_running');
  expect(r.error).toContain('modelo aberto');
});

test('fluxo feliz devolve o endpoint pronto pra conexão', async () => {
  const r = await discoverLocalXmla({
    platform: 'win32',
    exec: async (cmd) => (cmd === 'tasklist' ? TASKLIST_OK : NETSTAT),
  });
  expect(r).toMatchObject({ status: 'ok', port: 31272, endpoint: 'localhost:31272' });
});

test('processo de pé mas sem escutar ainda → not_running, não "falhou"', async () => {
  const r = await discoverLocalXmla({
    platform: 'win32',
    exec: async (cmd) => (cmd === 'tasklist' ? TASKLIST_OK : ''),
  });
  expect(r.status).toBe('not_running');
});

test('fora do Windows diz que não se aplica, em vez de tentar', async () => {
  const r = await discoverLocalXmla({ platform: 'linux' });
  expect(r.status).toBe('unsupported');
});

test('comando indisponível vira failed com o motivo — nunca lança', async () => {
  const r = await discoverLocalXmla({
    platform: 'win32',
    exec: async () => { throw new Error('tasklist não encontrado'); },
  });
  expect(r.status).toBe('failed');
  expect(r.error).toContain('tasklist');
});
