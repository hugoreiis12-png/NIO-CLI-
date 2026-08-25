import type { ProfileDefinition } from '../core/environment.js';
import { pythonToolchain } from './toolchains.js';
import { postgresMcp, powerbiMcp } from './mcps.js';

/**
 * Analyst — análise de dados em Python/SQL. Postgres pro operador consultar +
 * PowerBI (exclusivo de analyst/bi). O comando do PowerBI ainda é placeholder
 * (ver `mcps.ts`).
 */
export const analystProfile: ProfileDefinition = {
  profile: 'analyst',
  languages: ['python', 'sql'],
  toolchains: [pythonToolchain],
  frameworks: ['pandas', 'jupyter'],
  mcps: [postgresMcp, powerbiMcp],
};
