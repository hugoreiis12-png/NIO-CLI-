import type { ProfileDefinition } from '../core/environment.js';
import { pythonToolchain } from './toolchains.js';
import { postgresMcp, powerbiMcp } from './mcps.js';

/**
 * Analyst — análise de dados em Python/SQL. Postgres pro operador consultar +
 * PowerBI Modeling e Excel (perfis analytics: analyst/bi/scientist/dba). O Excel
 * é herdado da def validada do global do usuário (`inheritGlobalMcpIds`).
 */
export const analystProfile: ProfileDefinition = {
  profile: 'analyst',
  languages: ['python', 'sql'],
  toolchains: [pythonToolchain],
  frameworks: ['pandas', 'jupyter'],
  mcps: [postgresMcp, powerbiMcp],
  inheritGlobalMcpIds: ['excel'],
};
