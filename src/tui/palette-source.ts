/**
 * Fonte da paleta `/` da TUI — comandos `nio` (árvore viva do commander),
 * capacidades do agente (tools `nio_*`) e tópicos de ajuda (`content.ts`).
 * Puro e testável: sem IO, sem React.
 */
import type { Command } from 'commander';
import { toolDefinitions } from '../tools/index.js';
import { SECTIONS, TAGLINE } from '../cli/commands/docs/content.js';

export type PaletteItem =
  | { kind: 'command'; name: string; desc: string; line: string; destructive: boolean }
  | { kind: 'capability'; name: string; desc: string; prompt: string }
  | { kind: 'help'; name: string; desc: string; body: string };

/** Comandos que mexem/apagam — a paleta pede confirmação antes de rodar. */
const DESTRUCTIVE = /\b(delete|clean|clean-legacy|logout|disable-2fa|down)\b/;

/** id da tool → prompt pt-BR pro agente. Fallback = a própria description. */
const CAPABILITY_PROMPTS: Record<string, string> = {
  nio_session_create: 'Crie uma nova sessão de ambiente para este projeto.',
  nio_session_activate: 'Ative a sessão de ambiente que eu indicar.',
  nio_session_list: 'Liste as minhas sessões de ambiente.',
  nio_env_materialize: 'Materialize (re-aplique) o ambiente da sessão ativa.',
  nio_env_detect_deps: 'Verifique as dependências deste projeto e o que falta instalar.',
  nio_profile_get: 'Mostre o perfil e a recipe da sessão ativa.',
  nio_delegate_exec: 'Delegue a implementação da tarefa a um agente headless num worktree.',
  nio_plan: 'Rode o motor de planejamento sobre este projeto e escreva o plan.md.',
  nio_validate_plan: 'Valide o plan.md da raiz e diga se precisa de uma spec antes de implementar.',
  nio_exec_status: 'Mostre o estado dos jobs de execução (nio exec).',
};

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/\.(\s|$)/);
  return stop > 0 ? flat.slice(0, stop + 1) : flat;
}

function walkCommands(cmd: Command, prefix: string): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const sub of cmd.commands) {
    const nm = sub.name();
    if (nm === 'help') continue;
    const full = prefix ? `${prefix} ${nm}` : nm;
    const args = sub.commands.length > 0 ? '' : sub.usage().replace(/^\[options\]\s*/, '').trim();
    const desc = sub.description();
    if (desc) {
      out.push({
        kind: 'command',
        name: full,
        desc: firstSentence(desc),
        line: `nio ${full}${args ? ' ' + args : ''}`,
        destructive: DESTRUCTIVE.test(full),
      });
    }
    out.push(...walkCommands(sub, full));
  }
  return out;
}

export function buildPalette(program: Command): PaletteItem[] {
  const commands = walkCommands(program, '').sort((a, b) => a.name.localeCompare(b.name));
  const capabilities: PaletteItem[] = toolDefinitions.map((t) => ({
    kind: 'capability',
    name: t.name,
    desc: firstSentence(t.description ?? ''),
    prompt: CAPABILITY_PROMPTS[t.name] ?? t.description ?? t.name,
  }));
  const help: PaletteItem[] = [
    { kind: 'help', name: 'sobre o nio', desc: 'O que é a NIO-CLI', body: TAGLINE },
    ...SECTIONS.map((s) => ({
      kind: 'help' as const,
      name: s.title.toLowerCase(),
      desc: s.blurb ?? s.title,
      body: s.blocks
        .filter((b): b is { kind: 'p'; text: string } => b.kind === 'p')
        .map((b) => b.text)
        .join('\n\n'),
    })),
  ];
  return [...commands, ...capabilities, ...help];
}

/** Filtro por substring (case-insensitive) sobre nome + descrição. */
export function filterPalette(items: PaletteItem[], q: string): PaletteItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return items;
  return items.filter((i) => `${i.name} ${i.desc}`.toLowerCase().includes(s));
}
