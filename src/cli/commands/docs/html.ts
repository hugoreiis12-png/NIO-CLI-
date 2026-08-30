/**
 * Documentação como página HTML autocontida (zero request externo) — a forma
 * "arte" de `nio docs --html`. Design: terminal phosphor, tema claro/escuro.
 * Manutenção: `.claude/skills/nio-docs-page/SKILL.md`.
 */
import type { Block, DocSection } from './content.js';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** `texto com \`código\`` → HTML com <code>. */
const inline = (s: string): string =>
  esc(s).replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);

const STYLE = `
:root{
  --bg:#f6f8f5; --surface:#fff; --ink:#16211a; --muted:#5a6b60; --line:#dde5dd;
  --accent:#1a7f43; --accent-soft:#e3f2e6; --code-bg:#0d130f; --code-ink:#c8e6cf;
  --font:"Inter",ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#0a0e0b; --surface:#0f150f; --ink:#d7e5da; --muted:#7f9285; --line:#1e2a20;
  --accent:#4ade80; --accent-soft:#122417; --code-bg:#060907; --code-ink:#bfe9c9;
}}
:root[data-theme=dark]{
  --bg:#0a0e0b; --surface:#0f150f; --ink:#d7e5da; --muted:#7f9285; --line:#1e2a20;
  --accent:#4ade80; --accent-soft:#122417; --code-bg:#060907; --code-ink:#bfe9c9;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);
  line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:var(--mono);font-size:.88em;background:var(--accent-soft);
  color:var(--accent);padding:.1em .38em;border-radius:4px}
header.top{border-bottom:1px solid var(--line);background:var(--surface);
  position:sticky;top:0;z-index:5}
.top .inner{max-width:1000px;margin:0 auto;padding:22px 24px;
  display:flex;justify-content:space-between;align-items:baseline;gap:20px;flex-wrap:wrap}
.brand{font-family:var(--mono);font-weight:700;font-size:1.35rem;letter-spacing:.02em}
.brand .cursor{color:var(--accent)}
.ver{font-family:var(--mono);font-size:.78rem;color:var(--muted);
  border:1px solid var(--line);border-radius:999px;padding:.22em .7em;white-space:nowrap}
button.theme{font:inherit;font-size:.78rem;color:var(--muted);background:none;
  border:1px solid var(--line);border-radius:999px;padding:.28em .8em;cursor:pointer;margin-left:8px}
.tag{max-width:1000px;margin:0 auto;padding:16px 24px 0;color:var(--muted);font-size:.95rem}
nav.toc{max-width:1000px;margin:0 auto;padding:14px 24px 26px;display:flex;flex-wrap:wrap;
  gap:6px 16px;font-size:.84rem;border-bottom:1px solid var(--line)}
nav.toc a{color:var(--muted)}
nav.toc a:hover,nav.toc a.on{color:var(--accent);text-decoration:none}
main{max-width:1000px;margin:0 auto;padding:40px 24px 96px}
section{margin:0 0 48px;scroll-margin-top:80px}
h2{font-size:1.3rem;margin:0 0 4px;letter-spacing:-.01em}
.blurb{color:var(--muted);margin:0 0 18px;font-size:.95rem}
p{margin:0 0 14px;max-width:72ch}
ul{margin:0 0 16px;padding-left:20px;max-width:74ch}
li{margin:.4em 0}
pre{background:var(--code-bg);color:var(--code-ink);font-family:var(--mono);
  font-size:.82rem;line-height:1.6;padding:16px 18px;border-radius:10px;
  overflow-x:auto;border:1px solid var(--line);margin:0 0 18px}
pre code{background:none;color:inherit;padding:0;font-size:inherit}
.tbl{overflow-x:auto;margin:0 0 18px;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
th{font-weight:600;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
td:first-child{font-family:var(--mono);font-size:.85rem;white-space:nowrap}
@media(max-width:640px){td:first-child{white-space:normal}}
`;

function renderBlock(b: Block): string {
  if (b.kind === 'p') return `<p>${inline(b.text)}</p>`;
  if (b.kind === 'code') return `<pre><code>${esc(b.text)}</code></pre>`;
  if (b.kind === 'list') return `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
  const head = b.head.map((h) => `<th>${esc(h)}</th>`).join('');
  const rows = b.rows
    .map((r) => `<tr>${r.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="tbl"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

const SCRIPT = `
const root=document.documentElement,KEY='nio-docs-theme';
try{const t=localStorage.getItem(KEY);if(t)root.dataset.theme=t}catch(e){}
document.querySelector('button.theme').onclick=()=>{
  const sysDark=matchMedia('(prefers-color-scheme:dark)').matches;
  const cur=root.dataset.theme||(sysDark?'dark':'light');
  const next=cur==='dark'?'light':'dark';root.dataset.theme=next;
  try{localStorage.setItem(KEY,next)}catch(e){}};
const links=[...document.querySelectorAll('nav.toc a')];
addEventListener('scroll',()=>{let on=links[0];
  for(const l of links){const el=document.getElementById(l.hash.slice(1));
    if(el&&el.getBoundingClientRect().top<140)on=l}
  links.forEach(l=>l.classList.toggle('on',l===on))},{passive:true});
`;

export function renderHtml(
  sections: DocSection[],
  version: string,
  tagline: string,
): string {
  const nav = sections
    .map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`)
    .join(' ');
  const body = sections
    .map(
      (s) =>
        `<section id="${s.id}"><h2>${esc(s.title)}</h2>` +
        (s.blurb ? `<p class="blurb">${inline(s.blurb)}</p>` : '') +
        s.blocks.map(renderBlock).join('') +
        `</section>`,
    )
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NIO-CLI — documentação</title><style>${STYLE}</style></head><body>
<header class="top"><div class="inner">
<div class="brand">nio<span class="cursor">_</span></div>
<div style="white-space:nowrap"><span class="ver">v${esc(version)}</span>
<button class="theme">tema</button></div></div></header>
<p class="tag">${esc(tagline)}</p>
<nav class="toc">${nav}</nav>
<main>${body}</main>
<script>${SCRIPT}</script></body></html>`;
}
