import type { ProfileDefinition } from '../core/environment.js';
import { powerbiMcp } from './mcps.js';

/**
 * BI — business intelligence (SQL/DAX, modelagem PowerBI). PowerBI MCP é
 * exclusivo de bi/analyst. O comando ainda é placeholder (ver `mcps.ts`).
 */
export const biProfile: ProfileDefinition = {
  profile: 'bi',
  languages: ['sql', 'dax'],
  toolchains: [],
  frameworks: ['powerbi'],
  mcps: [powerbiMcp],
};
