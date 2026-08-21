import type { DbClient } from '../adapters/supabase/client.js';
import type { ProjectConfig } from '../config.js';
import type { ExchangeResult } from '../auth.js';
import { brand } from '../brand.js';

export interface ProjectContextRepository {
  id: string;
  name: string;
  url: string;
  default_branch: string;
  /** Contexto de IA do repo — vem pra TODOS os repos (orquestração multi-repo). */
  ai_context: string | null;
}

/** Mantido por compat; o repo "current" tem o mesmo shape dos demais. */
export type ProjectContextCurrentRepository = ProjectContextRepository;

export interface ProjectContextMember {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface ProjectContext {
  project: {
    id: string;
    name: string;
    color: string;
    monthly_hours: number | null;
    notes: string | null;
    ai_context: string | null;
  };
  current_repository: ProjectContextCurrentRepository | null;
  repositories: ProjectContextRepository[];
  active_sprint: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
  } | null;
  members: ProjectContextMember[];
  current_user: {
    id: string;
    email: string;
    full_name: string | null;
    username: string | null;
  };
}

/**
 * Erro com mensagem em pt-BR pronta pra mostrar ao usuário.
 * Wrappers (tool MCP, CLI) só precisam pegar `.message`.
 */
export class ProjectContextError extends Error {}

/**
 * Texto de "Sobre o projeto" pro harness (`AGENTS.md`), montado do `ai_context` do NOS —
 * projeto + cada repo que tenha contexto. Determinístico (não usa LLM). `''` se nada.
 */
export function buildProjectOverview(ctx: ProjectContext): string {
  const parts: string[] = [];
  if (ctx.project.ai_context?.trim()) parts.push(ctx.project.ai_context.trim());
  // Escopo pelo **repositório atribuído** (`repository_id`) quando há um selecionado — o
  // harness vive dentro dele. Sem repo (binding no projeto) → todos, pra orquestração.
  const repos = ctx.current_repository ? [ctx.current_repository] : ctx.repositories;
  for (const r of repos) {
    if (r.ai_context?.trim()) parts.push(`### ${r.name}\n\n${r.ai_context.trim()}`);
  }
  return parts.join('\n\n');
}

/**
 * Projetos **ativos em que o usuário é membro** (`project_members`). Duas queries
 * (memberships → projetos) pra tipagem limpa e independente de RLS: mesmo que o
 * usuário seja admin e o RLS deixe ver tudo, aqui recortamos pra atribuição real.
 */
export async function listMemberProjects(
  supabase: DbClient,
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const membersRes = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId);
  if (membersRes.error) {
    throw new ProjectContextError(`Erro ao listar suas atribuições: ${membersRes.error.message}`);
  }

  const ids = [...new Set((membersRes.data ?? []).map((r) => r.project_id))];
  if (ids.length === 0) return [];

  const projectsRes = await supabase
    .from('projects')
    .select('id, name')
    .eq('is_active', true)
    .in('id', ids)
    .order('name');
  if (projectsRes.error) {
    throw new ProjectContextError(`Erro ao listar projetos: ${projectsRes.error.message}`);
  }
  return (projectsRes.data ?? []).map((p) => ({ id: p.id, name: p.name }));
}

export async function fetchProjectContext(
  supabase: DbClient,
  config: ProjectConfig,
  user: ExchangeResult['user'],
): Promise<ProjectContext> {
  const projectId = config.project_id;
  if (!projectId) {
    throw new ProjectContextError('Nenhum projeto vinculado — não há contexto do NOS para carregar.');
  }

  const [projectRes, reposRes, sprintRes, membersRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, color, monthly_hours, notes, ai_context')
      .eq('id', projectId)
      .maybeSingle(),
    supabase
      .from('repositories')
      .select('id, project_id, name, url, default_branch, ai_context')
      .eq('project_id', projectId)
      .order('name'),
    supabase
      .from('sprints')
      .select('id, name, start_date, end_date')
      .eq('project_id', projectId)
      .eq('status', 'ativa')
      .maybeSingle(),
    supabase
      .from('project_members')
      .select('user_id, profiles:profiles!inner(id, full_name, username, avatar_url)')
      .eq('project_id', projectId),
  ]);

  if (projectRes.error) {
    throw new ProjectContextError(`Erro ao buscar projeto: ${projectRes.error.message}`);
  }
  if (!projectRes.data) {
    throw new ProjectContextError(
      `Projeto ${projectId} não encontrado ou você não tem acesso. Rode \`${brand.name} init\` pra revincular.`,
    );
  }
  if (reposRes.error) {
    throw new ProjectContextError(`Erro ao buscar repositórios: ${reposRes.error.message}`);
  }
  if (sprintRes.error) {
    throw new ProjectContextError(`Erro ao buscar sprint ativa: ${sprintRes.error.message}`);
  }
  if (membersRes.error) {
    throw new ProjectContextError(`Erro ao buscar membros: ${membersRes.error.message}`);
  }

  const project = projectRes.data;
  const allRepos = reposRes.data ?? [];
  const sprint = sprintRes.data;

  type MemberProfile = {
    id: string;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
  };
  type MemberRow = {
    user_id: string;
    profiles: MemberProfile | MemberProfile[] | null;
  };
  const memberRows = (membersRes.data ?? []) as unknown as MemberRow[];

  let currentRepository: ProjectContextCurrentRepository | null = null;
  if (config.repository_id) {
    const match = allRepos.find((r) => r.id === config.repository_id);
    if (match) {
      currentRepository = {
        id: match.id,
        name: match.name,
        url: match.url,
        default_branch: match.default_branch,
        ai_context: match.ai_context,
      };
    }
  }

  const members: ProjectContextMember[] = memberRows.map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      user_id: row.user_id,
      full_name: profile?.full_name ?? null,
      username: profile?.username ?? null,
      avatar_url: profile?.avatar_url ?? null,
    };
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      color: project.color,
      monthly_hours: project.monthly_hours,
      notes: project.notes,
      ai_context: project.ai_context,
    },
    current_repository: currentRepository,
    repositories: allRepos.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      default_branch: r.default_branch,
      ai_context: r.ai_context,
    })),
    active_sprint: sprint
      ? {
          id: sprint.id,
          name: sprint.name,
          start_date: sprint.start_date,
          end_date: sprint.end_date,
        }
      : null,
    members,
    current_user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      username: user.username,
    },
  };
}
