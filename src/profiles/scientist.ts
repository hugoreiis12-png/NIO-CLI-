import type { ProfileDefinition } from '../core/environment.js';
import { pythonToolchain } from './toolchains.js';

/** Scientist — dados / ML em Python. */
export const scientistProfile: ProfileDefinition = {
  profile: 'scientist',
  languages: ['python'],
  toolchains: [pythonToolchain],
  frameworks: ['jupyter', 'numpy', 'pytorch'],
  mcps: [],
};
