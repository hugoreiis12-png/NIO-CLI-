import { test, expect } from 'bun:test';
import { definition, handleLangRecipe } from './lang-recipe.js';
import type { LanguageCatalog, LanguageRecipe } from '../core/lang.js';

const tsRecipe: LanguageRecipe = {
  language: 'typescript',
  runtime: 'node',
  packageManagers: ['npm'],
  baseLibs: [],
  frameworks: ['next'],
  orms: ['prisma'],
  typings: ['typescript', '@types/node'],
  mcpSdk: '@modelcontextprotocol/sdk',
};

function fakeCatalog(): LanguageCatalog {
  return {
    recipe: (l) => {
      if (l === 'typescript') return tsRecipe;
      throw new Error(`Linguagem "${l}" ainda não tem recipe.`);
    },
  };
}

const textOf = (r: { content: Array<{ text?: string }> }) => r.content[0]?.text ?? '';

test('definition: nome e schema esperados', () => {
  expect(definition.name).toBe('nio_lang_recipe');
  expect(definition.inputSchema.required).toContain('language');
});

test('handler: recipe existente → JSON com os campos', () => {
  const r = handleLangRecipe({ language: 'typescript' }, fakeCatalog());
  expect(r.isError).toBeFalsy();
  expect(textOf(r)).toContain('prisma');
  expect(textOf(r)).toContain('@modelcontextprotocol/sdk');
});

test('handler: linguagem inválida → erro sem chamar o catálogo', () => {
  const r = handleLangRecipe({ language: 'ruby' }, fakeCatalog());
  expect(r.isError).toBe(true);
});

test('handler: recipe não modelada → propaga o erro do catálogo', () => {
  const r = handleLangRecipe({ language: 'n8n' }, fakeCatalog());
  expect(r.isError).toBe(true);
  expect(textOf(r)).toMatch(/ainda não tem recipe/);
});
