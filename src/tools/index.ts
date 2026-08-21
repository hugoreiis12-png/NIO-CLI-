import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Gateway } from '../core/ports.js';
import type { ProjectConfig } from '../config.js';
import type { ExchangeResult } from '../auth.js';

import * as getContext from './get-context.js';
import * as listProjects from './list-projects.js';
import * as setProject from './set-project.js';
import * as listTasks from './list-tasks.js';
import * as getTask from './get-task.js';
import * as createTask from './create-task.js';
import * as updateTask from './update-task.js';
import * as moveTask from './move-task.js';
import * as commentTask from './comment-task.js';
import * as startAllocation from './start-allocation.js';
import * as endAllocation from './end-allocation.js';
import * as startTaskAllocation from './start-task-allocation.js';
import * as endTaskAllocation from './end-task-allocation.js';
import * as getActiveAllocation from './get-active-allocation.js';
import * as listMyAllocations from './list-my-allocations.js';
import * as recordDelivery from './record-delivery.js';
import * as delegateExec from './delegate-exec.js';
import * as execStatus from './exec-status.js';
import * as plan from './plan.js';
import * as validatePlan from './validate-plan.js';

export interface ToolContext {
  /** Porta de dados — o ÚNICO caminho de acesso ao backend a partir das tools. */
  gateway: Gateway;
  user: ExchangeResult['user'];
  config: ProjectConfig | null;
}

export interface ToolModule {
  definition: Tool;
  handler: (args: unknown, ctx: ToolContext) => Promise<CallToolResult>;
}

export const tools: Record<string, ToolModule> = {
  [getContext.definition.name]: getContext,
  [listProjects.definition.name]: listProjects,
  [setProject.definition.name]: setProject,
  [listTasks.definition.name]: listTasks,
  [getTask.definition.name]: getTask,
  [createTask.definition.name]: createTask,
  [updateTask.definition.name]: updateTask,
  [moveTask.definition.name]: moveTask,
  [commentTask.definition.name]: commentTask,
  [startAllocation.definition.name]: startAllocation,
  [endAllocation.definition.name]: endAllocation,
  [startTaskAllocation.definition.name]: startTaskAllocation,
  [endTaskAllocation.definition.name]: endTaskAllocation,
  [getActiveAllocation.definition.name]: getActiveAllocation,
  [listMyAllocations.definition.name]: listMyAllocations,
  [recordDelivery.definition.name]: recordDelivery,
  [delegateExec.definition.name]: delegateExec,
  [execStatus.definition.name]: execStatus,
  [plan.definition.name]: plan,
  [validatePlan.definition.name]: validatePlan,
};

export const toolDefinitions: Tool[] = Object.values(tools).map((t) => t.definition);
