import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { confirm, input, password, select, checkbox, NonInteractiveError } from './prompts.js';

/**
 * Contrato do guard não-TTY: sem terminal interativo (Git Bash sem winpty, pipe,
 * CI) o prompt NÃO some com exit(130) — usa o default se houver, senão falha alto.
 */
describe('prompts sem TTY', () => {
  const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  });
  afterEach(() => {
    if (original) Object.defineProperty(process.stdin, 'isTTY', original);
  });

  it('confirm sem default lança NonInteractiveError', async () => {
    await expect(confirm({ message: 'Prosseguir?' })).rejects.toBeInstanceOf(NonInteractiveError);
  });

  it('confirm com default retorna o default', async () => {
    expect(await confirm({ message: 'Prosseguir?', default: true })).toBe(true);
    expect(await confirm({ message: 'Prosseguir?', default: false })).toBe(false);
  });

  it('input com default retorna o default', async () => {
    expect(await input({ message: 'Nome?', default: 'nio' })).toBe('nio');
  });

  it('input sem default lança', async () => {
    await expect(input({ message: 'Nome?' })).rejects.toBeInstanceOf(NonInteractiveError);
  });

  it('password sempre lança (nunca tem default)', async () => {
    await expect(password({ message: 'Senha?' })).rejects.toBeInstanceOf(NonInteractiveError);
  });

  it('select com default retorna o default', async () => {
    const r = await select({
      message: 'Perfil?',
      choices: [
        { name: 'A', value: 'a' },
        { name: 'B', value: 'b' },
      ],
      default: 'b',
    });
    expect(r).toBe('b');
  });

  it('checkbox lança (não tem default)', async () => {
    await expect(
      checkbox({ message: 'Quais?', choices: [{ name: 'A', value: 'a' }] }),
    ).rejects.toBeInstanceOf(NonInteractiveError);
  });
});
