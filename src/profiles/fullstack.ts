import type { ProfileDefinition } from '../core/environment.js';
import { nodeToolchain } from './toolchains.js';

/** Fullstack — front + back em TS/JS sobre Node. */
export const fullstackProfile: ProfileDefinition = {
  profile: 'fullstack',
  languages: ['typescript', 'javascript'],
  toolchains: [nodeToolchain],
  frameworks: ['react', 'next', 'express'],
  mcps: [],
};
