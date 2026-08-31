import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { launchAiClient, HeadroomRequiredError } from './ai-client.js';

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

test('launchAiClient: Headroom fora → lança HeadroomRequiredError, NÃO spawna', async () => {
  const { fn, calls } = fakeSpawn();
  await expect(
    launchAiClient(
      { cwd: '/x' },
      { ensureHeadroom: async () => ({ ok: false, started: false, error: 'sem Docker' }), spawnFn: fn, isInstalled: () => true },
    ),
  ).rejects.toBeInstanceOf(HeadroomRequiredError);
  expect(calls).toHaveLength(0);
});

test('launchAiClient: Headroom ok → spawna opencode interativo (sem args)', async () => {
  const { fn, calls } = fakeSpawn();
  const code = await launchAiClient(
    { cwd: '/proj' },
    { ensureHeadroom: async () => ({ ok: true, started: true }), spawnFn: fn, isInstalled: () => true },
  );
  expect(code).toBe(0);
  expect(calls[0].cmd).toBe('opencode');
  expect(calls[0].args).toEqual([]);
});

test('launchAiClient: com prompt → opencode run --model <m> "<prompt>"', async () => {
  const { fn, calls } = fakeSpawn();
  await launchAiClient(
    { cwd: '/proj', prompt: 'oi' },
    { ensureHeadroom: async () => ({ ok: true, started: false }), spawnFn: fn, isInstalled: () => true },
  );
  expect(calls[0].args[0]).toBe('run');
  expect(calls[0].args).toContain('--model');
  expect(calls[0].args.at(-1)).toBe('oi');
});

test('launchAiClient: OpenCode ausente → 127, não spawna', async () => {
  const { fn, calls } = fakeSpawn();
  const code = await launchAiClient(
    { cwd: '/proj' },
    { ensureHeadroom: async () => ({ ok: true, started: false }), spawnFn: fn, isInstalled: () => false },
  );
  expect(code).toBe(127);
  expect(calls).toHaveLength(0);
});
