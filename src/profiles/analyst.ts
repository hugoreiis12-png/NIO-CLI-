import type { ProfileDefinition } from '../core/environment.js';
import { pythonToolchain } from './toolchains.js';
import { postgresMcp, powerbiMcp } from './mcps.js';

/**
 * Analyst — análise de dados em Python/SQL. Postgres pro operador consultar +
 * PowerBI Modeling (exclusivo de analyst/bi).
 */
export const analystProfile: ProfileDefinition = {
  profile: 'analyst',
  languages: ['python', 'sql'],
  toolchains: [pythonToolchain],
  frameworks: ['pandas', 'jupyter'],
  mcps: [postgresMcp, powerbiMcp],
};
