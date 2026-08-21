import type { DbClient } from './client.js';
import type { ContextGateway } from '../../core/ports.js';
import type { ProjectConfig } from '../../config.js';
import type { ProjectRef, User } from '../../core/types.js';
import { fetchProjectContext, listMemberProjects } from '../../lib/project-context.js';

/** Adaptador Supabase do `ContextGateway` (projeto/contexto/membros). */
export function contextGateway(db: DbClient): ContextGateway {
  return {
    getContext(config: ProjectConfig, user: User) {
      return fetchProjectContext(db, config, user);
    },

    listProjects(userId: string) {
      return listMemberProjects(db, userId);
    },

    async findProjectById(projectId: string): Promise<ProjectRef | null> {
      const { data, error } = await db
        .from('projects')
        .select('id, name')
        .eq('id', projectId)
        .maybeSingle();
      if (error) throw new Error(`Erro ao validar projeto: ${error.message}`);
      return data ?? null;
    },
  };
}
