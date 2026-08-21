import AdmZip from "adm-zip";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { VERSION } from "../version.js";
import { toolDefinitions } from "../tools/index.js";
import { brand, envName } from "../brand.js";

/**
 * Raiz do pacote instalado (onde ficam `dist/` e `node_modules/`).
 * Este módulo compila para dist/lib/cowork-extension.js, então sobe dois níveis.
 */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // .../dist/lib
  return join(here, "..", "..");
}

/** Nome + descrição normalizada (espaços colapsados, até 160 chars — limite do MCPB). */
function mapCoworkTools(tools: { name: string; description?: string }[]): { name: string; description: string }[] {
  return tools.map((t) => ({
    name: t.name,
    description: (t.description ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160),
  }));
}

/** Bloco `server` do manifest: como o Claude Desktop sobe o servidor MCP do nio. */
function buildCoworkServerConfig(): Record<string, unknown> {
  return {
    type: "node",
    entry_point: "dist/mcp-server.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/dist/mcp-server.js"],
      env: {
        [envName('PAT')]: '${user_config.pat}',
        [envName('PROJECT_ID')]: '${user_config.project_id}',
        [envName('REPOSITORY_ID')]: '${user_config.repository_id}',
        // Cowork ignora ~/.claude → o servidor pula o auto-pull e entrega as skills
        // por resources + prompts.
        [envName('CLIENT')]: 'cowork',
      },
    },
  };
}

/** Bloco `user_config` do manifest: campos que o app pede na instalação (o PAT). */
function buildCoworkUserConfig(): Record<string, unknown> {
  return {
    pat: {
      type: "string",
      title: "NOS Personal Access Token (PAT)",
      description:
        `PAT do ${brand.productName} (formato ${brand.patPrefix}…). O projeto é escolhido por sessão com as tools ${brand.toolPrefix}list_projects / ${brand.toolPrefix}set_project — não há nada de projeto para configurar aqui.`,
      sensitive: true,
      required: true,
    },
  };
}

/** Gera o objeto manifest.json (spec MCPB) para a versão atual. */
export function buildCoworkManifest(): Record<string, unknown> {
  return {
    manifest_version: "0.2",
    name: brand.mcpBinName,
    display_name: `${brand.name} (${brand.productName})`,
    version: VERSION,
    description:
      "MCP server pra controlar o NOS — tarefas, kanban e ponto/cronometragem — a partir do Claude Desktop / Cowork.",
    long_description:
      `Servidor MCP do NOS. Permite ao assistente ler o contexto do projeto, listar/criar/atualizar/mover/comentar tarefas e gerenciar alocações (bater ponto e cronometrar tempo por task). A autenticação usa um PAT do NOS, fornecido via configuração da extensão (${envName('PAT')}).`,
    author: { name: brand.productName, url: `https://github.com/${brand.githubOrg}` },
    homepage: `https://github.com/${brand.githubOrg}/${brand.githubRepo}#readme`,
    documentation: `https://github.com/${brand.githubOrg}/${brand.githubRepo}#readme`,
    support: `https://github.com/${brand.githubOrg}/${brand.githubRepo}/issues`,
    keywords: ["mcp", "nio", "nos", "tasks", "kanban", "time-tracking"],
    server: buildCoworkServerConfig(),
    user_config: buildCoworkUserConfig(),
    tools: mapCoworkTools(toolDefinitions),
    compatibility: {
      platforms: ["darwin", "win32", "linux"],
      runtimes: { node: ">=20.0.0" },
    },
  };
}

/**
 * Adiciona recursivamente os arquivos de `localDir` ao zip sob `zipPrefix`,
 * usando separadores POSIX e sem criar entradas de diretório. Pula source maps.
 */
function addFilesRecursively(
  zip: AdmZip,
  localDir: string,
  zipPrefix: string,
): void {
  for (const entry of readdirSync(localDir, { withFileTypes: true })) {
    const localPath = join(localDir, entry.name);
    const zipPath = `${zipPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      addFilesRecursively(zip, localPath, zipPath);
    } else if (entry.isFile() && !entry.name.endsWith(".map")) {
      zip.addFile(zipPath, readFileSync(localPath));
    }
  }
}

export interface GenerateResult {
  outputPath: string;
}

/** Pasta de destino do .mcpb: ~/Downloads se existir, senão o home. */
function defaultOutputDir(): string {
  const downloads = join(homedir(), "Downloads");
  return existsSync(downloads) ? downloads : homedir();
}

/**
 * Gera o pacote .mcpb (manifest + dist + node_modules) a partir da instalação atual.
 * Source maps são omitidos pra reduzir o tamanho.
 */
export function generateCoworkExtension(
  outputDir: string = defaultOutputDir(),
): GenerateResult {
  const root = packageRoot();
  const distDir = join(root, "dist");
  const nodeModulesDir = join(root, "node_modules");

  if (!existsSync(distDir)) {
    throw new Error(
      `Não encontrei dist/ em ${root}. Reinstale o pacote (npm i -g ${brand.packageName}).`,
    );
  }

  const manifest = buildCoworkManifest();
  const zip = new AdmZip();

  zip.addFile(
    "manifest.json",
    Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"),
  );

  // Adiciona só arquivos (sem entradas de diretório), como o `mcpb pack` faz —
  // entradas de pasta quebram o instalador do MCPB. Source maps são omitidos.
  addFilesRecursively(zip, distDir, "dist");
  if (existsSync(nodeModulesDir)) {
    addFilesRecursively(zip, nodeModulesDir, "node_modules");
  }

  const outputPath = join(outputDir, `${brand.mcpBinName}-${VERSION}.mcpb`);
  zip.writeZip(outputPath);
  return { outputPath };
}

/** Abre a pasta no explorador de arquivos do SO (best-effort, ignora falhas). */
export function revealInFileManager(target: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  try {
    const child = spawn(cmd, [target], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // sem file manager disponível — ignora
  }
}
