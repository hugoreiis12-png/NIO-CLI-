import type { ProfileDefinition } from '../core/environment.js';
import { pythonToolchain } from './toolchains.js';
import { powerbiMcp } from './mcps.js';

/** Scientist — dados / ML em Python. Perfil analytics: PowerBI + Excel (Excel
 *  herdado da def validada do global). */
export const scientistProfile: ProfileDefinition = {
  profile: 'scientist',
  languages: ['python'],
  toolchains: [pythonToolchain],
  frameworks: ['jupyter', 'numpy', 'pytorch'],
  mcps: [powerbiMcp],
  inheritGlobalMcpIds: ['excel'],
};
