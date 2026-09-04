import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { launchAiClient, ensureHeadroomAndWire } from './ai-client.js';

/** spawn falso — emite exit 0 no próximo tick, registra a argv. */
function fakeSpawn() {
  const calls: { cmd: string; args: string[] }[] = [];
  const fn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const ee = new EventEmitter() as EventEmitter & { on: EventEmitter['on'] };
    setTimeout(() => ee.emit('exit', 0), 0);
    return ee;
  }) as unknown as typeof import('node:child_process').spawn;
  return { fn, calls };
}

test('ensureHeadroomAndWire: não lança (Headroom desativado — wiring direto)', async () => {
  const r = await ensureHeadroomAndWire();
  expect(r).toBeUndefined();
});

test('launchAiClient: headless → opencode run --model <m> "<prompt>"', async () => {
  const { fn, calls } = fakeSpawn();
  const code = await launchAiClient(
    { cwd: '/proj', prompt: 'diga oi' },
    { spawnFn: fn, isInstalled: () => true },
  );
  expect(code).toBe(0);
  expect(calls[0].cmd).toBe('opencode');
  expect(calls[0].args[0]).toBe('run');
  expect(calls[0].args).toContain('--model');
  expect(calls[0].args.at(-1)).toBe('diga oi');
});

test('launchAiClient: OpenCode ausente → 127, não spawna', async () => {
  const { fn, calls } = fakeSpawn();
  const code = await launchAiClient(
    { cwd: '/proj', prompt: 'oi' },
    { spawnFn: fn, isInstalled: () => false },
  );
  expect(code).toBe(127);
  expect(calls).toHaveLength(0);
});
