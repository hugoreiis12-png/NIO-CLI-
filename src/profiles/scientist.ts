import type { ProfileDefinition } from '../core/environment.js';
import { pythonToolchain } from './toolchains.js';
import { excelMcp } from './mcps.js';
import { ANALYTICS_AUTO_APPROVE } from './auto-approve.js';

/** Scientist — dados / ML em Python. Perfil analytics: PowerBI + Excel (Excel
 *  modelado/semeado no global e ainda herdado por id; a def do global vence). */
export const scientistProfile: ProfileDefinition = {
  profile: 'scientist',
  languages: ['python'],
  toolchains: [pythonToolchain],
  frameworks: ['jupyter', 'numpy', 'pytorch'],
  mcps: [excelMcp],
  inheritGlobalMcpIds: ['excel'],
  autoApprove: ANALYTICS_AUTO_APPROVE,
};
