import { select } from "../../lib/prompts.js";
import { c, sym } from "../../lib/colors.js";

/**
 * Report do `sync`: em vez de despejar tudo no terminal, cada etapa **informativa** vira
 * uma seção (título + status + resumo + detalhe). Um renderer decide como mostrar
 * (resumo / verbose / quiet / plano-CI) e, no modo interativo, o usuário navega as seções.
 */

export type SectionStatus = "ok" | "warn" | "error";

export interface SyncSection {
  id: string;
  title: string;
  status: SectionStatus;
  /** Uma linha curta (contadores) pro resumo. */
  summary: string;
  /** As linhas de detalhe (a saída "de sempre" da etapa). */
  lines: string[];
}

export type ReportMode = "summary" | "verbose" | "quiet" | "plain";

/**
 * Captura o que `fn` imprimiria via `console.log` num array de linhas — deixa reusar os
 * `print*` existentes como fonte do detalhe, sem reescrevê-los.
 */
export function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return lines;
}

export class SyncReport {
  readonly sections: SyncSection[] = [];

  add(section: SyncSection): void {
    this.sections.push(section);
  }

  /** Adiciona uma seção cujo detalhe vem da saída capturada de `fn`. */
  addCaptured(
    meta: { id: string; title: string; status: SectionStatus; summary: string },
    fn: () => void,
  ): void {
    this.add({ ...meta, lines: capture(fn) });
  }
}

/** Resumo + status de um resultado de provisionamento (usado por sync e init). */
export function summarizeProvision(
  files: { action: string }[],
): { status: SectionStatus; summary: string } {
  const n = (a: string) => files.filter((f) => f.action === a).length;
  const werr = n("write-error");
  const conflict = n("skip-conflict");
  const parts = [`${n("create")} criados`, `${n("update")} atualizados`];
  if (n("prune")) parts.push(`${n("prune")} removidos`);
  if (conflict) parts.push(`${conflict} conflito`);
  if (werr) parts.push(`${werr} erro`);
  return {
    status: werr > 0 ? "error" : conflict > 0 ? "warn" : "ok",
    summary: parts.join(" · "),
  };
}

function icon(status: SectionStatus): string {
  return status === "ok"
    ? c.green(sym.ok)
    : status === "warn"
      ? c.yellow(sym.warn)
      : c.red(sym.err);
}

function headline(s: SyncSection): string {
  return `  ${icon(s.status)} ${c.bold(s.title)} ${c.dim(`· ${s.summary}`)}`;
}

/** Resolve o modo: `--verbose`/`--quiet` mandam; senão TTY → resumo, não-TTY → plano. */
export function resolveReportMode(opts: { verbose?: boolean; quiet?: boolean }): ReportMode {
  if (opts.verbose) return "verbose";
  if (opts.quiet) return "quiet";
  return process.stdout.isTTY ? "summary" : "plain";
}

/** Imprime o report conforme o modo. */
export function renderReport(report: SyncReport, mode: ReportMode): void {
  if (report.sections.length === 0) return;
  console.log("");

  if (mode === "verbose" || mode === "plain") {
    for (const s of report.sections) {
      console.log(headline(s));
      for (const l of s.lines) console.log(l);
    }
    return;
  }

  // summary / quiet: uma linha por seção; no summary, expande as que não estão ok.
  for (const s of report.sections) {
    console.log(headline(s));
    if (mode === "summary" && s.status !== "ok") for (const l of s.lines) console.log(l);
  }
}

const DONE = "__done__";

/**
 * Menu navegável pós-resumo (só TTY): o usuário escolhe uma seção pra ver o detalhe e
 * volta ao menu; "seguir" continua o fluxo. É o "ir pro lado e ver as outras infos".
 */
export async function browseReport(report: SyncReport): Promise<void> {
  if (!process.stdout.isTTY || report.sections.length === 0) return;

  for (;;) {
    const choice = await select<string>({
      message: "Ver o detalhe de alguma seção? (↑/↓ navega, enter abre)",
      choices: [
        { name: c.dim("▶ seguir"), value: DONE },
        ...report.sections.map((s) => ({
          name: `${icon(s.status)} ${s.title} ${c.dim(`— ${s.summary}`)}`,
          value: s.id,
        })),
      ],
    });
    if (choice === DONE) return;
    const sec = report.sections.find((s) => s.id === choice);
    if (sec) {
      console.log("");
      for (const l of sec.lines) console.log(l);
      console.log("");
    }
  }
}
