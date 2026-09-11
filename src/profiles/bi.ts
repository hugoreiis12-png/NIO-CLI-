import type { ProfileDefinition } from '../core/environment.js';
import { powerbiMcp } from './mcps.js';
import { postgresqlClientToolchain, powerbiDesktopToolchain } from './toolchains.js';

/**
 * BI — business intelligence (SQL/DAX, modelagem PowerBI). Toolchains locais
 * (`psql` + Power BI Desktop, com auto-install via `winget` no Windows) + o MCP
 * PowerBI Modeling (exclusivo de bi/analyst, comando oficial via npx — ver
 * `mcps.ts`), que fala com o Desktop aberto.
 */
export const biProfile: ProfileDefinition = {
  profile: 'bi',
  languages: ['sql', 'dax'],
  toolchains: [postgresqlClientToolchain, powerbiDesktopToolchain],
  frameworks: ['powerbi'],
  mcps: [powerbiMcp],
};
