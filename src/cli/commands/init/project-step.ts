import { select, input } from "../../../lib/prompts.js";
import { section } from "../../../lib/colors.js";
import { startSpinner } from "../../../spinner.js";
import { UUID_REGEX, type ProjectConfig, type Ide } from "../../../config.js";
import { listMemberProjects } from "../../../lib/project-context.js";
import type { DbClient } from "../../../adapters/supabase/client.js";
import { initCopy } from "../../copy.js";

const MANUAL_PROJECT = "__manual__";
const NO_REPO = "__none__";

/** Busca os projetos dos quais o usuário é membro; sai do processo se a busca
 * falhar ou se a lista vier vazia (nada pra vincular). */
export async function fetchMemberProjectsStep(
  supabase: DbClient,
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const projectsSpinner = startSpinner("Buscando seus projetos...");
  let projects: { id: string; name: string }[];
  try {
    projects = await listMemberProjects(supabase, userId);
  } catch (err) {
    projectsSpinner.fail(`Erro ao buscar projetos: ${(err as Error).message}`);
    process.exit(1);
  }
  projectsSpinner.stop();

  if (projects.length === 0) {
    console.error(
      "Você não é membro de nenhum projeto. Peça a um admin pra te adicionar.",
    );
    process.exit(1);
  }
  return projects;
}

/**
 * Dado o id escolhido/digitado e a lista de projetos do usuário, resolve o
 * projeto selecionado. Cai num objeto sintético `{id, name: id}` quando o id
 * não está na lista (ex.: colado manualmente).
 */
export function resolveSelectedProject(
  projectId: string,
  projects: { id: string; name: string }[],
): { id: string; name: string } {
  return projects.find((p) => p.id === projectId) ?? { id: projectId, name: projectId };
}

/** Prompt de escolha do projeto — lista os projetos do usuário + opção de digitar um id manualmente. */
export async function pickProject(
  projects: { id: string; name: string }[],
): Promise<{ id: string; name: string }> {
  let projectId = await select<string>({
    message: initCopy.pickProject,
    choices: [
      ...projects.map((p) => ({ name: p.name, value: p.id })),
      { name: initCopy.manualProjectChoice, value: MANUAL_PROJECT },
    ],
  });

  if (projectId === MANUAL_PROJECT) {
    projectId = await input({
      message: initCopy.manualProjectPrompt,
      validate: (value) =>
        UUID_REGEX.test(value.trim()) || initCopy.manualProjectInvalid,
    });
    projectId = projectId.trim();
  }

  return resolveSelectedProject(projectId, projects);
}

/** Traduz a escolha do prompt de repositório pro `repository_id` persistido. */
export function resolveRepositoryChoice(choice: string): string | null {
  return choice === NO_REPO ? null : choice;
}

/** Busca os repositórios do projeto e, se houver algum, oferece vincular um (ou nenhum). */
export async function pickRepository(
  supabase: DbClient,
  projectId: string,
): Promise<string | null> {
  const reposSpinner = startSpinner("Buscando repositórios...");
  const reposResult = await supabase
    .from("repositories")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");

  if (reposResult.error) {
    reposSpinner.fail(
      `Erro ao buscar repositórios: ${reposResult.error.message}`,
    );
    process.exit(1);
  }
  reposSpinner.stop();

  const repos = reposResult.data ?? [];
  if (repos.length === 0) return null;

  const choice = await select<string>({
    message: initCopy.linkRepo,
    choices: [
      { name: initCopy.noRepoChoice, value: NO_REPO },
      ...repos.map((r) => ({ name: r.name, value: r.id })),
    ],
  });
  return resolveRepositoryChoice(choice);
}

/** Monta o `ProjectConfig` base a partir do projeto e (opcional) repositório escolhidos. */
export function buildBaseConfig(
  projectId: string,
  repositoryId: string | null,
): ProjectConfig {
  const config: ProjectConfig = { project_id: projectId };
  if (repositoryId) config.repository_id = repositoryId;
  return config;
}

/** Prompt de IDE — habilita integrações específicas de editor no resto do CLI. */
export async function pickIde(): Promise<Ide> {
  console.log("");
  section("IDE", "habilita integrações de editor");
  return select<Ide>({
    message:
      "Qual IDE você usa? Isso habilita integrações — ex.: o /implement " +
      "registra o worktree criado no editor (VS Code: adiciona ao Source Control; " +
      "Xcode: abre o projeto em janela própria). Mais integrações no futuro.",
    choices: [
      { name: "VS Code", value: "vscode" },
      { name: "Xcode", value: "xcode" },
      { name: "Outra", value: "other" },
    ],
  });
}
