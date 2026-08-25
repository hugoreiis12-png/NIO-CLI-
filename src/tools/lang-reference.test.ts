import { test, expect } from 'bun:test';
import { definition, handleLangReference } from './lang-reference.js';
import type { KnowledgeStore, LangReference } from '../core/lang.js';

function fakeStore(ref: Partial<LangReference>): KnowledgeStore {
  return {
    reference: (language) => ({ language, found: true, content: 'ok', ...ref }),
  };
}

test('definition: nome e schema esperados', () => {
  expect(definition.name).toBe('nio_lang_reference');
  expect(definition.inputSchema.required).toContain('language');
});

test('handler: linguagem válida → conteúdo do store, sem erro', () => {
  const res = handleLangReference({ language: 'typescript' }, fakeStore({ content: 'ref TS' }));
  expect(res.isError).toBeFalsy();
  expect(res.content[0]).toMatchObject({ type: 'text', text: 'ref TS' });
});

test('handler: cache ausente (found:false) → isError true', () => {
  const res = handleLangReference({ language: 'python' }, fakeStore({ found: false, content: 'sync' }));
  expect(res.isError).toBe(true);
});

test('handler: linguagem inválida → erro claro sem chamar o store', () => {
  const res = handleLangReference({ language: 'cobol' }, fakeStore({}));
  expect(res.isError).toBe(true);
  expect(res.content[0]).toMatchObject({ type: 'text' });
});
