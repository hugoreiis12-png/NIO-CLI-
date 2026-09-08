/**
 * Guia de uso que aparece DEPOIS da lista de comandos em `nio --help` / `nio help`
 * (`addHelpText("after", …)` em `program.ts`). É o "manual rápido": o fluxo de
 * primeiros passos + como a interface do `nio ai` funciona (teclas, modos,
 * paleta, permissões). O manual COMPLETO é `nio docs`.
 */
import { c, sym } from "../lib/colors.js";

const H = (t: string): string => c.bold.underline(t.toUpperCase());
const K = (t: string): string => c.cyan(t); // tecla / comando
const D = (t: string): string => c.dim(t);

export function usageGuide(): string {
  const L: string[] = [];
  const p = (s = ""): void => void L.push(s);

  p();
  p(D("─".repeat(60)));
  p(
    "NIO monta ambientes de desenvolvimento reproduzíveis (perfil + wizard →",
  );
  p(
    "toolchains, linguagens, MCPs, dotfiles, IDE) e abre um operador de IA sobre",
  );
  p("eles. A entidade central é a " + c.bold("Sessão") + " — um ambiente isolado no Postgres.");
  p();

  p(H("Começar"));
  p(`  ${K("nio")}                 a esteira guiada: config → gateway → login → sessão → ${K("nio ai")}`);
  p(`  ${D("│")}                   detecta onde você parou e conduz, perguntando antes de cada passo`);
  p(`  ${D("│")}                   saiu no meio? ela imprime a linha exata pra retomar (${K("nio start")})`);
  p();
  p(`  ${D("na mão, se preferir:")}`);
  p(`  ${K("nio config setup")}    cola ${c.bold("NIO_DATABASE_URL")} + ${c.bold("JWT_SECRET")} (o time te passa), testa, salva`);
  p(`  ${K("nio register")}        cria seu usuário  ${sym.arrow}  ${K("nio login")} salva o JWT em ~/.nio/session.json`);
  p(`  ${K("nio init")}            wizard de perfil/recipe, materializa o ambiente da sessão`);
  p(`  ${K("nio ai")}              abre a interface do operador na sessão ativa`);
  p();

  p(H("A interface do `nio ai`"));
  p("  Chat no terminal (Ink) sobre o motor " + c.bold("opencode/big-pickle") + ". Uma superfície só:");
  p("  o pensamento, as ferramentas, os arquivos e as perguntas do agente aparecem");
  p("  em linha, no estilo do Claude Code — sem sidebar, sem janela extra.");
  p();
  p(c.bold("  Digitar & enviar"));
  p(`    ${K("Enter")}            envia   ${D("·")}   ${K("\\")} + ${K("Enter")} ${D("ou")} ${K("Ctrl-J")}   quebra linha (prompt multi-linha)`);
  p(`    ${K("←/→ ↑/↓")}          move o cursor no texto   ${D("·")}   ${K("Ctrl-A/E")} início/fim da linha`);
  p(`    ${K("Ctrl-W")}           apaga a palavra   ${D("·")}   ${K("Ctrl-U")} apaga até o início   ${D("·")}   ${K("Ctrl-K")} até o fim`);
  p(`    colar bloco       entra literal (não envia sozinho)`);
  p();
  p(c.bold("  Modos") + D("  (o modo troca o comportamento do agente)"));
  p(`    ${K("Tab")}              alterna ${c.bold("build")} ${sym.arrow} ${c.bold("plan")} ${sym.arrow} …   (os agentes primários do opencode.json)`);
  p(`    ${D("build")} executa; ${D("plan")} só propõe. O modo atual fica no rodapé: ${D("[build]")}`);
  p();
  p(c.bold("  Paleta de comandos"));
  p(`    ${K("/")}                abre a lista inline (comandos do ${K("nio")} + capacidades do operador)`);
  p(`    ${K("↑/↓")} + ${K("Enter")}      roda o comando / manda a capacidade pro agente / abre o painel`);
  p(`    ${K("Esc")}              fecha a lista — o que você já digitou continua lá`);
  p();
  p(c.bold("  Quando o agente te interrompe"));
  p(`    ${c.bold("Permissão")}        rodar shell, editar arquivo, MCP…  ${sym.arrow}  modal:`);
  p(`                      ${K("a")}/${K("Enter")} permite uma vez  ${D("·")}  ${K("s")} sempre (salva a regra)  ${D("·")}  ${K("d")}/${K("Esc")} nega`);
  p(`                      pedidos em paralelo entram numa fila (${D("+N na fila")}); um sub-agente`);
  p(`                      travado é recuperado sozinho em ~4s`);
  p(`    ${c.bold("Pergunta")}         terminou com "?" ${sym.arrow} o cue ${D('↳ o nio perguntou')} aparece acima do input`);
  p(`    ${c.bold("Opções")}           listou 1./2./3. ${sym.arrow} menu ${K("↑/↓")}+${K("Enter")}; ou ignore e escreva livre`);
  p();
  p(c.bold("  Acompanhar & controlar"));
  p(`    ${K("Ctrl-R")}           expande/colapsa o raciocínio (✻) — ver o agente "pensar" ao vivo`);
  p(`    ${K("Esc")}              durante o processamento: aborta o turno`);
  p(`    rodapé            modelo · pasta · sessão · tokens · [modo]  +  toasts do motor`);
  p(`    ${D("✎ diff / ☑ checklist / ● tool(args) ⎿ saída")} — refletem o motor em tempo real`);
  p();

  p(H("Mais"));
  p(`  ${K("nio <cmd> --help")}    ajuda de um comando específico`);
  p(`  ${K("nio docs")}            o manual completo no terminal   ${D("·")}   ${K("nio docs --html --open")} como página`);
  p(`  ${K("nio debug")}           checa tudo (config, login, banco, sessão, opencode) com dica por item`);
  p(`  ${K("nio sessions")}        lista/ativa/pausa as suas sessões de ambiente`);
  p(`  ${D("NIO_DEBUG=1 nio <cmd>")}  log verboso em stderr + stack trace completo nos erros`);
  p(`  ${D("NIO_NO_ANIM=1")}          desliga a animação do logo`);
  p(D("─".repeat(60)));

  return L.join("\n");
}
