import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { UserCli } from '../core/session.js';
import type { ProjectConfig } from '../config.js';

import * as delegateExec from './delegate-exec.js';
import * as execStatus from './exec-status.js';
import * as plan from './plan.js';
import * as validatePlan from './validate-plan.js';

export interface ToolContext {
  /** Identidade v2 resolvida da sessão local (~/.nio/session.json). */
  user: UserCli;
  /** Binding do repo (`nio.json`), se existir — pode ser null. */
  config: ProjectConfig | null;
}

export interface ToolModule {
  definition: Tool;
  handler: (args: unknown, ctx: ToolContext) => Promise<CallToolResult>;
}

export const tools: Record<string, ToolModule> = {
  [delegateExec.definition.name]: delegateExec,
  [execStatus.definition.name]: execStatus,
  [plan.definition.name]: plan,
  [validatePlan.definition.name]: validatePlan,
};

export const toolDefinitions: Tool[] = Object.values(tools).map((t) => t.definition);
