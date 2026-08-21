import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "./index.js";
import { jsonResult, errorResult } from "../lib/tool-result.js";
import { resolveProjectConfig, isErrorResult } from "../lib/require-config.js";
import { brand } from "../brand.js";

const ArgsSchema = z
  .object({
    task_id: z.uuid(),
    content: z
      .string()
      .trim()
      .min(1, "Comentário não pode estar vazio.")
      .max(5000, "Comentário não pode passar de 5000 caracteres."),
    project_id: z.uuid().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}comment_task`,
  description:
    "Adiciona um comentário em uma tarefa. O comentário fica visível pros humanos na UI " +
    "junto com os outros comentários da task.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", format: "uuid" },
      content: { type: "string", minLength: 1, maxLength: 5000 },
      project_id: {
        type: "string",
        format: "uuid",
        description: `Override do projeto. Se omitido, usa o projeto ativo (${brand.toolPrefix}set_project) ou o default.`,
      },
    },
    required: ["task_id", "content"],
    additionalProperties: false,
  },
};

/** Monta o registro de histórico do comentário, truncando o preview. Pura. */
export function buildCommentHistoryEntry(
  taskId: string,
  userId: string,
  content: string,
): {
  task_id: string;
  user_id: string;
  action: "commented";
  field: null;
  new_value: string;
} {
  return {
    task_id: taskId,
    user_id: userId,
    action: "commented",
    field: null,
    new_value: content.slice(0, 200),
  };
}

/** Monta o payload de resposta do comment_task. Pura. */
export function buildCommentResult(comment: {
  id: string;
  task_id: string;
  created_at: string;
}): Record<string, unknown> {
  return {
    comment_id: comment.id,
    task_id: comment.task_id,
    created_at: comment.created_at,
  };
}

export async function handler(
  args: unknown,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success)
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  const { task_id, content } = parsed.data;
  const cfg = resolveProjectConfig(ctx, parsed.data.project_id);
  if (isErrorResult(cfg)) return cfg;

  let comment;
  try {
    comment = await ctx.gateway.commentTask(
      task_id,
      cfg.project_id,
      ctx.user.id,
      content,
      buildCommentHistoryEntry(task_id, ctx.user.id, content),
    );
  } catch (err) {
    return errorResult((err as Error).message);
  }
  if (!comment)
    return errorResult("Tarefa não encontrada ou fora do projeto atual.");
  return jsonResult(buildCommentResult(comment));
}
