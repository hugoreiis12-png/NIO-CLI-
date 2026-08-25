/**
 * Implementação do `KnowledgeStore` (`core/lang.ts`) — lê a referência do cache
 * vendorado dos 5 repos em `~/.nio/lang/<repo>/`.
 *
 * MVP (fatia 1): serve o README do repo da linguagem; `topic` refina em fatia
 * posterior. O fetch/vendor do cache (git clone dos repos) é a fatia 2
 * (`nio lang sync`). `baseDir` é seam opcional pra teste.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homePath } from '../../brand.js';
import type { KnowledgeStore, LangReference, LanguageId } from '../../core/lang.js';
import { LANG_REPOS } from './repos.js';

function findReadme(dir: string): string | null {
  for (const name of ['README.md', 'readme.md', 'README.MD']) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Dirs pesados/irrelevantes ignorados na busca por `.md`. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv']);

/** Coleta `.md` do repo (profundidade e quantidade limitadas). */
function collectMarkdown(root: string, limit = 300): { abs: string; rel: string }[] {
  const out: { abs: string; rel: string }[] = [];
  const walk = (d: string, rel: string, depth: number): void => {
    if (out.length >= limit || depth > 5) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r, depth + 1);
      else if (e.name.toLowerCase().endsWith('.md')) out.push({ abs, rel: r });
    }
  };
  walk(root, '', 0);
  return out;
}

/** Melhor `.md` do repo pro `topic`: nome do arquivo pesa alto, ocorrências no conteúdo somam. */
function searchTopic(dir: string, topic: string): { rel: string; content: string } | null {
  const t = topic.toLowerCase();
  let best: { rel: string; content: string } | null = null;
  let bestScore = 0;
  for (const { abs, rel } of collectMarkdown(dir)) {
    let content: string;
    try {
      content = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    const nameScore = rel.toLowerCase().includes(t) ? 100 : 0;
    const occurrences = content.toLowerCase().split(t).length - 1;
    const score = nameScore + occurrences;
    if (score > bestScore) {
      bestScore = score;
      best = { rel, content };
    }
  }
  return bestScore > 0 ? best : null;
}

export function createKnowledgeStore(baseDir: string = homePath('lang')): KnowledgeStore {
  return {
    reference(language: LanguageId, topic?: string): LangReference {
      const repoDir = LANG_REPOS[language].dir;
      const dir = join(baseDir, repoDir);
      if (!existsSync(dir)) {
        return {
          language,
          found: false,
          content: `Conhecimento de "${language}" ainda não sincronizado. Rode \`nio lang sync\`.`,
        };
      }

      // Com `topic`: busca o `.md` mais relevante dentro do repo vendorado.
      const wanted = topic?.trim();
      if (wanted) {
        const hit = searchTopic(dir, wanted);
        if (hit) {
          return { language, found: true, content: hit.content, source: `${repoDir}/${hit.rel}` };
        }
        // Sem match → cai no README, avisando.
      }

      const readme = findReadme(dir);
      if (!readme) {
        return { language, found: false, content: `Sem referência legível em ${repoDir}.` };
      }
      const note = wanted ? `> (nenhum doc casou "${wanted}" — devolvendo o README de ${repoDir})\n\n` : '';
      return {
        language,
        found: true,
        content: note + readFileSync(readme, 'utf-8'),
        source: repoDir,
      };
    },
  };
}
