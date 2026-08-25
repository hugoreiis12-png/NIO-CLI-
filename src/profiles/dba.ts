import type { ProfileDefinition } from '../core/environment.js';
import { postgresMcp } from './mcps.js';

/**
 * Perfil DBA — administração de banco. Primeira definição de ponta a ponta
 * (fatia vertical do EnvironmentBuilder): cliente `psql` como toolchain + MCP de
 * Postgres pra o operador de IA consultar o banco.
 *
 * NOTA (questão em aberto — auth dos MCPs, ver doc de arquitetura): a string de
 * conexão do Postgres não é resolvível no catálogo (é segredo por ambiente).
 * Aqui declaramos o env var que o MCP lê; quem preenche o valor de verdade é o
 * usuário/host, não o `nio init`. O catálogo é só dados — ajustável sem tocar
 * no pipeline.
 */
export const dbaProfile: ProfileDefinition = {
  profile: 'dba',
  languages: ['sql'],
  toolchains: [
    {
      id: 'postgresql-client',
      detect: [
        '/usr/bin/psql',
        '/usr/local/bin/psql',
        '/opt/homebrew/bin/psql',
        'C:/Program Files/PostgreSQL/**/bin/psql.exe',
      ],
      // Sem `install` universal (varia muito por SO) — detectável, orienta se faltar.
    },
  ],
  frameworks: [],
  mcps: [postgresMcp],
  envVars: { PGCLIENTENCODING: 'UTF8' },
  aliases: { pg: 'psql' },
};
