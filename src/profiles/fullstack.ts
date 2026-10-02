import type { ProfileDefinition } from '../core/environment.js';
import { nodeToolchain } from './toolchains.js';
import { FULLSTACK_AUTO_APPROVE } from './auto-approve.js';

/** Fullstack — front + back em TS/JS sobre Node. */
export const fullstackProfile: ProfileDefinition = {
  profile: 'fullstack',
  languages: ['typescript', 'javascript'],
  toolchains: [nodeToolchain],
  frameworks: ['react', 'next', 'express'],
  mcps: [],
  autoApprove: FULLSTACK_AUTO_APPROVE,
};
