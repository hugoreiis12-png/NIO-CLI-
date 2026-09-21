import type { ProfileDefinition } from '../core/environment.js';
import { pythonToolchain } from './toolchains.js';
import { powerbiMcp, excelMcp } from './mcps.js';

/** Scientist — dados / ML em Python. Perfil analytics: PowerBI + Excel (Excel
 *  modelado/semeado no global e ainda herdado por id; a def do global vence). */
export const scientistProfile: ProfileDefinition = {
  profile: 'scientist',
  languages: ['python'],
  toolchains: [pythonToolchain],
  frameworks: ['jupyter', 'numpy', 'pytorch'],
  mcps: [powerbiMcp, excelMcp],
  inheritGlobalMcpIds: ['excel'],
};
