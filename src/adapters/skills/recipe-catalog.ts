/**
 * `RecipeCatalog` sobre o cache do repo NIO-SKILLS (`~/.nio/skills/recipes/*.md`).
 * Sprint 5.2 — lê presets de ambiente editáveis sem release da CLI. Best-effort:
 * `recipes/` ausente, skills não baixadas, ou arquivo mal-formado → o wizard
 * segue sem recipe (nunca quebra).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Profile } from '../../core/types.js';
import type { EnvironmentRecipe, RecipeCatalog } from '../../core/environment.js';
import { skillsDir, parseFrontmatter } from '../../lib/skills/skills.js';

const PROFILES = new Set<Profile>(['fullstack', 'analyst', 'scientist', 'dba', 'qa', 'bi']);

/** Lista separada por vírgula/espaço → itens sem vazios. */
function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `k=v, k2=v2` → objeto. Par sem `=` ou sem chave é ignorado. */
function parseKv(value?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value) return out;
  for (const pair of value.split(',')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const key = pair.slice(0, i).trim();
    if (key) out[key] = pair.slice(i + 1).trim();
  }
  return out;
}

/** `<baseDir>/recipes/*.md` → recipes válidas. Arquivo inválido → aviso no stderr, pula. */
function loadRecipes(baseDir: string): EnvironmentRecipe[] {
  if (!baseDir) return [];
  const recipesDir = join(baseDir, 'recipes');
  if (!existsSync(recipesDir)) return [];

  const out: EnvironmentRecipe[] = [];
  for (const entry of readdirSync(recipesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    if (entry.name.toLowerCase() === 'readme.md') continue;

    const slug = entry.name.replace(/\.md$/i, '');
    const { frontmatter: fm, body } = parseFrontmatter(readFileSync(join(recipesDir, entry.name), 'utf8'));
    const profile = fm.profile?.trim() as Profile | undefined;
    if (!profile || !PROFILES.has(profile)) {
      console.error(`[nio] recipe "${slug}" ignorada: profile inválido (${fm.profile ?? 'ausente'}).`);
      continue;
    }

    out.push({
      slug,
      title: fm.title?.trim() || slug,
      description: fm.description?.trim() || '',
      profile,
      languages: parseList(fm.languages),
      frameworks: parseList(fm.frameworks),
      toolchainIds: parseList(fm.toolchains),
      mcpIds: parseList(fm.mcps),
      envVars: parseKv(fm.envVars),
      aliases: parseKv(fm.aliases),
      notes: body.trim(),
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

class SkillsRepoRecipeCatalog implements RecipeCatalog {
  constructor(private readonly baseDir: string) {}

  list(profile?: Profile): EnvironmentRecipe[] {
    const all = loadRecipes(this.baseDir);
    return profile ? all.filter((r) => r.profile === profile) : all;
  }

  get(slug: string): EnvironmentRecipe | null {
    return loadRecipes(this.baseDir).find((r) => r.slug === slug) ?? null;
  }
}

/**
 * Catálogo lendo `~/.nio/skills/recipes/` (ou `dir` explícito — seam de teste).
 * Skills não baixadas (`skillsDir()` lança) → catálogo vazio, não propaga.
 */
export function createRecipeCatalog(dir?: string): RecipeCatalog {
  let base = '';
  try {
    base = dir ?? skillsDir();
  } catch {
    /* skills não baixadas → catálogo vazio */
  }
  return new SkillsRepoRecipeCatalog(base);
}
