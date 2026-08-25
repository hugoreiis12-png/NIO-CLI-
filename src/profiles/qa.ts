import type { ProfileDefinition } from '../core/environment.js';
import { nodeToolchain } from './toolchains.js';

/** QA — testes e qualidade sobre Node (Playwright/Vitest). */
export const qaProfile: ProfileDefinition = {
  profile: 'qa',
  languages: ['typescript'],
  toolchains: [nodeToolchain],
  frameworks: ['playwright', 'vitest'],
  mcps: [],
  aliases: { e2e: 'npx playwright test' },
};
