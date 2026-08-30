import { test, expect, afterEach } from 'bun:test';
import { renderMatrixLogo, animateMatrixLogo } from './matrix-logo.js';

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

test('animateMatrixLogo: fora de TTY → escreve o estático uma vez, sem cursor-up', async () => {
  // bun:test não roda em TTY, então isTTY já é falsy.
  const out = await capture(() => animateMatrixLogo({ colored: false }));
  expect(out).toBe(renderMatrixLogo({ colored: false }) + '\n');
  expect(out).not.toContain('\x1b['); // nenhum ANSI (nem cor nem cursor)
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
