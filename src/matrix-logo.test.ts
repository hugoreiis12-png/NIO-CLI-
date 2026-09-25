import { test, expect, afterEach } from 'bun:test';
import { renderMatrixLogo, animateMatrixLogo, shouldDrawLogo } from './matrix-logo.js';

const origWrite = process.stdout.write.bind(process.stdout);
afterEach(() => {
  process.stdout.write = origWrite;
});

/** Captura tudo que a função escreve em stdout. */
async function capture(fn: () => void | Promise<void>): Promise<string> {
  let out = '';
  process.stdout.write = ((s: string) => {
    out += s;
    return true;
  }) as typeof process.stdout.write;
  await fn();
  process.stdout.write = origWrite;
  return out;
}

test('renderMatrixLogo: determinístico (mesma seed → mesma saída)', () => {
  const a = renderMatrixLogo({ colored: false });
  const b = renderMatrixLogo({ colored: false });
  expect(a).toBe(b);
  expect(a.split('\n')).toHaveLength(24);
  expect(a).toContain('██'); // o logo está lá
});

test('renderMatrixLogo: seeds diferentes → chuvas diferentes', () => {
  expect(renderMatrixLogo({ colored: false, seed: 1 })).not.toBe(
    renderMatrixLogo({ colored: false, seed: 2 }),
  );
});

test('ACEITE: fora de TTY não escreve NADA — nem o frame estático', async () => {
  // Mudança deliberada de contrato. Antes escrevia o estático, e era esse o problema:
  // `nio --help` capturado devolvia 144 linhas, as 24 primeiras de katakana meia-largura
  // antes do `Usage:`. Num preview truncado o agente via só o lixo e concluía que o
  // comando não retornou nada. Decoração é para humano em terminal.
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  try {
    expect(await capture(() => animateMatrixLogo({ colored: false }))).toBe('');
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true });
  }
});

test('terminal pequeno COM TTY ainda recebe o estático (há humano lendo)', async () => {
  // Animação desligada tem duas causas; só a ausência de TTY significa "ninguém olhando".
  const linhas = process.stdout.rows;
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: 5, configurable: true });
  try {
    const out = await capture(() => animateMatrixLogo({ colored: false }));
    expect(out).toBe(renderMatrixLogo({ colored: false }) + '\n');
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: linhas, configurable: true });
  }
});

test('animateMatrixLogo: NIO_NO_ANIM força o estático mesmo com TTY', async () => {
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  process.env.NIO_NO_ANIM = '1';
  try {
    const out = await capture(() => animateMatrixLogo({ colored: false }));
    expect(out).toBe(renderMatrixLogo({ colored: false }) + '\n');
  } finally {
    delete process.env.NIO_NO_ANIM;
    Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true });
  }
});

test('ACEITE: fora de TTY não se desenha o logo (é ruído pra quem captura)', () => {
  // Medido em prod: `nio --help` capturado dava 144 linhas, as 24 primeiras de
  // katakana. Com a saída truncada, o agente via só o lixo e concluía que o comando
  // não retornou nada — e gastava turnos tentando contornar.
  const antes = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  try {
    expect(shouldDrawLogo()).toBe(false);
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { value: antes, configurable: true });
  }
});

test('em TTY desenha, mas não em CI', () => {
  const antes = process.stdout.isTTY;
  const ci = process.env.CI;
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  try {
    delete process.env.CI;
    expect(shouldDrawLogo()).toBe(true);
    process.env.CI = '1';
    expect(shouldDrawLogo()).toBe(false);
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { value: antes, configurable: true });
    if (ci === undefined) delete process.env.CI; else process.env.CI = ci;
  }
});

test('o render em si continua puro — sempre devolve a arte', () => {
  expect(renderMatrixLogo().length).toBeGreaterThan(100);
});
