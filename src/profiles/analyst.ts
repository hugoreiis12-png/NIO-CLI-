import type { ProfileDefinition } from '../core/environment.js';
import { pythonToolchain, uvToolchain } from './toolchains.js';
import { postgresMcp, excelMcp } from './mcps.js';
import { ANALYTICS_AUTO_APPROVE } from './auto-approve.js';

/**
 * Analyst — análise de dados em Python/SQL. Postgres pro operador consultar +
 * PowerBI Modeling e Excel (perfis analytics: analyst/bi/scientist/dba). O Excel
 * é modelado (semeado no global) e ainda herdado por id — a def do usuário no
 * global vence a modelada, se houver (`inheritGlobalMcpIds`).
 */
export const analystProfile: ProfileDefinition = {
  profile: 'analyst',
  languages: ['python', 'sql'],
  toolchains: [pythonToolchain, uvToolchain],
  frameworks: ['pandas', 'jupyter'],
  mcps: [postgresMcp, excelMcp],
  inheritGlobalMcpIds: ['excel'],
  autoApprove: ANALYTICS_AUTO_APPROVE,
};
