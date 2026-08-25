import { basename } from "node:path";
import { select, input } from "../../../lib/prompts.js";
import { section } from "../../../lib/colors.js";
import type { Profile } from "../../../core/session.js";
import type { Ide } from "../../../config.js";

/** Rótulos dos perfis (`sessions.profile`) pro prompt do `nio init`. */
const PROFILE_CHOICES: { name: string; value: Profile }[] = [
  { name: "Fullstack — front + back", value: "fullstack" },
  { name: "Analyst — análise de dados", value: "analyst" },
  { name: "Scientist — dados / ML", value: "scientist" },
  { name: "DBA — administração de banco", value: "dba" },
  { name: "QA — testes e qualidade", value: "qa" },
  { name: "BI — business intelligence", value: "bi" },
];

/** Prompt de perfil — dita o toolchain/framework que o `EnvironmentBuilder` materializa. */
export async function pickProfile(): Promise<Profile> {
  section("Ambiente", "qual perfil de sessão montar");
  return select<Profile>({
    message: "Qual perfil descreve o que você vai fazer nesta sessão?",
    choices: PROFILE_CHOICES,
  });
}

/** Prompt do nome da sessão — default é o nome da pasta atual. */
export async function pickSessionName(cwd: string = process.cwd()): Promise<string> {
  const suggested = basename(cwd);
  return input({
    message: "Nome da sessão?",
    default: suggested,
    validate: (v) => v.trim().length > 0 || "O nome não pode ficar vazio.",
  });
}

/** Prompt de IDE — habilita integrações específicas de editor. */
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
