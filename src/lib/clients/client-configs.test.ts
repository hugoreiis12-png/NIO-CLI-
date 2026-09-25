import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planOpencodeUpdate,
  planNioAiProvider,
  upsertOpencodeMcp,
  installOpencodeGlobal,
  NIO_OPERATOR_MODEL,
  NIO_AI_BASE_URL,
  NIO_AI_PROVIDER,
  NIO_AI_MODEL_ID,
  NIO_AI_CONTEXT,
  NIO_AI_OUTPUT,
  declaredContextWindow,
  modelCapabilities,
  contextConfigWarning,
  toolOutputLimits,
  compactionReserved,
} from './client-configs.js';
import type { McpSpec } from '../../core/environment.js';

const NIO_ENTRY = { command: ['nio-cli'], environment: {} as Record<string, string> };
const PG_MCP: McpSpec = {
  id: 'postgres',
  command: ['npx', '-y', '@modelcontextprotocol/server-postgres'],
  environment: { DATABASE_URL: 'x' },
};

test('planOpencodeUpdate: grava model + mcp.nio + MCPs do perfil num config vazio', () => {
  const { next } = planOpencodeUpdate({}, NIO_ENTRY, [PG_MCP]);
  expect(next.model).toBe(NIO_OPERATOR_MODEL);
  const mcp = next.mcp as any;
  expect(mcp.nio.command).toEqual(['nio-cli']);
  expect(mcp.postgres.command).toEqual(PG_MCP.command);
  expect(mcp.postgres.enabled).toBe(true);
});

test('planNioAiProvider: cria provider dedicado (npm openai-compatible + baseURL + modelo/limite), preserva o resto', () => {
  const out = planNioAiProvider(
    { model: 'x', provider: { anthropic: { options: { foo: 1 } } } },
    'nio-local',
    'http://192.168.0.140:8001/v1',
    'RedHatAI/Qwen3.8-27B-INT4',
    65536,
    20000,
  );
  const p = out.provider as Record<string, any>;
  expect(p['nio-local'].npm).toBe('@ai-sdk/openai-compatible');
  expect(p['nio-local'].options.baseURL).toBe('http://192.168.0.140:8001/v1');
  // 65536 real - 20000 output - 10% margem = 32983 declarado ao opencode.
  expect(p['nio-local'].models['RedHatAI/Qwen3.8-27B-INT4'].limit).toEqual({
    context: declaredContextWindow(65536, 20000),
    output: 20000,
  });
  expect(p['nio-local'].models['RedHatAI/Qwen3.8-27B-INT4'].attachment).toBe(true);
  expect(p.anthropic.options.foo).toBe(1); // não mexeu noutro provider
  expect(out.model).toBe('x');
});

test('planOpencodeUpdate: com baseURL → semeia o provider dedicado, NÃO toca o opencode, alreadyConfigured idempotente', () => {
  const url = 'http://192.168.0.140:8001/v1';
  const first = planOpencodeUpdate({}, NIO_ENTRY, [], url);
  const p = first.next.provider as Record<string, any>;
  expect(p[NIO_AI_PROVIDER].options.baseURL).toBe(url);
  // Janela declarada = real - output - margem. Nem crua (o servidor conta prompt+output
  // contra o mesmo teto) nem apertada demais (sub-declarar causava loop de compactação).
  expect(p[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID].limit.context).toBe(
    declaredContextWindow(NIO_AI_CONTEXT, NIO_AI_OUTPUT),
  );
  expect(p.opencode).toBeUndefined(); // opencode fica no default, sem hijack

  const seeded = first.next;
  expect(planOpencodeUpdate(seeded, NIO_ENTRY, [], url).alreadyConfigured).toBe(true);
  expect(planOpencodeUpdate(seeded, NIO_ENTRY, [], 'http://other/v1').alreadyConfigured).toBe(false);
});

test('planOpencodeUpdate: idempotente — rodar sobre o próprio resultado marca alreadyConfigured', () => {
  const { next } = planOpencodeUpdate({}, NIO_ENTRY, [PG_MCP]);
  const again = planOpencodeUpdate(next, NIO_ENTRY, [PG_MCP]);
  expect(again.alreadyConfigured).toBe(true);
});

test('planOpencodeUpdate: MCP do perfil ausente → não está configurado ainda', () => {
  const semPerfil = planOpencodeUpdate({}, NIO_ENTRY, []).next;
  const { alreadyConfigured } = planOpencodeUpdate(semPerfil, NIO_ENTRY, [PG_MCP]);
  expect(alreadyConfigured).toBe(false);
});

test('planOpencodeUpdate: preserva mcp.nio e chaves não-nio do usuário', () => {
  const existing = {
    theme: 'dark',
    mcp: { custom: { type: 'local', command: ['meu-mcp'], enabled: true } },
  };
  const { next } = planOpencodeUpdate(existing, NIO_ENTRY, [PG_MCP]);
  expect(next.theme).toBe('dark');
  const mcp = next.mcp as any;
  expect(mcp.custom.command).toEqual(['meu-mcp']); // chave do usuário intacta
  expect(mcp.nio.command).toEqual(['nio-cli']);
  expect(mcp.postgres.command).toEqual(PG_MCP.command);
});

test('installOpencodeGlobal: aponta o provider pro backend de IA (NIO_AI_BASE_URL) por padrão', () => {
  const d = mkdtempSync(join(tmpdir(), 'nio-ai-'));
  const p = join(d, 'opencode.json');

  installOpencodeGlobal([], p); // sem baseURL explícito → herda o default (NIO_AI_BASE_URL)
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  expect(cfg.provider[NIO_AI_PROVIDER].options.baseURL).toBe(NIO_AI_BASE_URL);
  expect(cfg.provider[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID].limit.context).toBe(
    declaredContextWindow(NIO_AI_CONTEXT, NIO_AI_OUTPUT),
  );
  expect(cfg.model).toBe(NIO_OPERATOR_MODEL);
  expect(cfg.provider.opencode).toBeUndefined(); // opencode fica no default (big-pickle)

  rmSync(d, { recursive: true, force: true });
});

test('upsertOpencodeMcp: registra um MCP remoto (type: remote + url), preserva o resto', () => {
  const d = mkdtempSync(join(tmpdir(), 'nio-mcp-'));
  const p = join(d, 'opencode.json');
  writeFileSync(p, JSON.stringify({ model: 'x', mcp: { nio: { type: 'local', command: ['nio-cli'] } } }));

  const dockerSpec: McpSpec = { id: 'docker', url: 'http://127.0.0.1:8811/mcp' };
  const r1 = upsertOpencodeMcp(dockerSpec, { path: p });
  expect(r1.status).toBe('updated');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  expect(cfg.model).toBe('x');
  expect(cfg.mcp.nio.command).toEqual(['nio-cli']);
  expect(cfg.mcp.docker).toEqual({ type: 'remote', url: 'http://127.0.0.1:8811/mcp', enabled: true });

  // idempotente
  expect(upsertOpencodeMcp(dockerSpec, { path: p }).status).toBe('already_configured');

  // remove → enabled: false
  const r3 = upsertOpencodeMcp(dockerSpec, { remove: true, path: p });
  expect(r3.status).toBe('updated');
  expect(JSON.parse(readFileSync(p, 'utf8')).mcp.docker.enabled).toBe(false);

  rmSync(d, { recursive: true, force: true });
});

test('upsertOpencodeMcp: cria o arquivo se não existe', () => {
  const d = mkdtempSync(join(tmpdir(), 'nio-mcp-'));
  const p = join(d, 'sub', 'opencode.json');
  // path com dir inexistente → writeJson deve criar (mkdir -p no file-merge)
  const r = upsertOpencodeMcp({ id: 'docker', url: 'http://x/mcp' }, { path: p });
  expect(['created', 'updated']).toContain(r.status);
  rmSync(d, { recursive: true, force: true });
});

test('contextConfigWarning: avisa janela pequena demais, silencia janela sã ou desativada', () => {
  expect(contextConfigWarning(10000, 2048)).toBeTruthy(); // 10000 ≤ 2048 + 8000
  expect(contextConfigWarning(98304, 2048)).toBeNull(); // folgada
  expect(contextConfigWarning(0, 2048)).toBeNull(); // 0 = declaração desativada
});

test('compactionReserved: 10% da janela com piso 8000, nunca acima do contexto', () => {
  expect(compactionReserved(98304)).toBe(9830); // ~10% de 98304
  expect(compactionReserved(65536)).toBe(8000); // 10% (6554) < piso → piso
  expect(compactionReserved(200000)).toBe(20000); // 10% de janela grande
  expect(compactionReserved(5000)).toBe(5000); // piso 8000 > contexto → capa no contexto
  expect(compactionReserved(0)).toBe(8000); // declaração desativada → piso
});

test('janela declarada fica ENTRE o piso de compactação e o teto do servidor', () => {
  // Este teste guardava "declarada == real", porque sub-declarar (64K) fazia o opencode
  // achar o contexto sempre cheio e compactar em loop. Só que declarar a real também
  // quebra: o servidor conta prompt + output contra o mesmo `max_model_len`, então a
  // janela cheia autoriza um prompt que estoura por construção — e quem estoura é a
  // própria compactação, que reenvia o histórico inteiro. Aí a sessão morre de vez.
  // O invariante certo é a faixa: abaixo do teto do servidor, acima do piso do loop.
  const { next } = planOpencodeUpdate({}, NIO_ENTRY, [], NIO_AI_BASE_URL);
  const p = next.provider as Record<string, any>;
  const declarado = p[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID].limit.context;

  expect(declarado + NIO_AI_OUTPUT).toBeLessThan(NIO_AI_CONTEXT);
  expect(declarado).toBeGreaterThan(NIO_AI_OUTPUT + compactionReserved(NIO_AI_CONTEXT));
});


test('ACEITE: a janela declarada cabe no teto do servidor junto com o output', () => {
  // O estouro real: prompt 96257 + output 2048 = 98305 contra max_model_len 98304.
  // O servidor soma os dois contra o MESMO teto, então declarar a janela cheia
  // autoriza um prompt que estoura por construção.
  const real = 98304;
  const output = 2048;
  const declarado = declaredContextWindow(real, output);

  expect(declarado + output).toBeLessThan(real);
  expect(declarado).toBeLessThan(96257); // o prompt que matou a sessão não seria autorizado
});

test('a margem cobre a subestimativa medida do contador do opencode', () => {
  // Medido: o prompt chegou a 96257 reais sem disparar a compactação prevista para
  // ~90304 — o contador do opencode erra pra menos em ao menos 6%.
  const real = 98304;
  const declarado = declaredContextWindow(real, 2048);
  const piorCaso = declarado * 1.06; // mesmo subestimando, o prompt real fica abaixo do teto

  expect(piorCaso + 2048).toBeLessThan(real);
});

test('não sub-declara a ponto de reabrir o loop de compactação', () => {
  // Regressão conhecida: janela apertada demais faz o opencode compactar em loop.
  expect(contextConfigWarning(98304, 2048)).toBeNull();
  expect(declaredContextWindow(98304, 2048)).toBeGreaterThan(2048 + 8000);
});

test('declaração desativada (0) passa reta', () => {
  expect(declaredContextWindow(0, 2048)).toBe(0);
});

test('ACEITE: o modelo é declarado como capaz de anexo — sem isso a imagem é descartada', () => {
  // Medido com proxy no caminho real (opencode serve → vLLM):
  //   sem `attachment: true` → 0 partes image_url chegam, o modelo responde
  //   "não aceito imagens"; com a flag → 1 image_url chega e ele descreve a imagem.
  const { next } = planOpencodeUpdate({}, NIO_ENTRY, [], NIO_AI_BASE_URL);
  const modelo = (next.provider as Record<string, any>)[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID];

  expect(modelo.attachment).toBe(true);
  expect(modelo.modalities.input).toContain('image');
});

test('capacidades usam só chaves do schema oficial (additionalProperties: false)', () => {
  // Chave inventada aqui quebra o opencode.json inteiro, não só a visão.
  const permitidas = ['attachment', 'modalities'];
  expect(Object.keys(modelCapabilities(true)).every((k) => permitidas.includes(k))).toBe(true);
  expect(modelCapabilities(true).modalities).toEqual({ input: ['text', 'image'], output: ['text'] });
});

test('backend texto-only → nenhuma capacidade declarada', () => {
  // Declarar visão num backend que não tem faria o opencode mandar imagem que o servidor recusa.
  expect(modelCapabilities(false)).toEqual({});
});

test('config antigo sem attachment é considerado desatualizado (força a reescrita)', () => {
  // A regressão da frente 1 foi exatamente esta: o disco divergia do esperado e ninguém
  // reconciliava, então o usuário ficava com a config velha pra sempre.
  const seeded = planOpencodeUpdate({}, NIO_ENTRY, [], NIO_AI_BASE_URL).next;
  const p = seeded.provider as Record<string, any>;
  delete p[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID].attachment;

  expect(planOpencodeUpdate(seeded, NIO_ENTRY, [], NIO_AI_BASE_URL).alreadyConfigured).toBe(false);
});

test('tool_output: teto padrão corta o que entraria no contexto, sem perder o dado', () => {
  // O opencode grava o texto inteiro em disco e devolve preview — apertar é barato.
  const lim = toolOutputLimits()!;
  expect(lim.max_bytes).toBe(20_000);
  expect(lim.max_lines).toBe(800);
  expect(lim.max_bytes!).toBeLessThan(51_200); // mais apertado que o default do opencode
});
