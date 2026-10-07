// Personagem NIO em pixel-art com efeito Matrix.
// Ciclo (loop): integra (parado) → cruza os braços → desintegra (braços cruzados)
//  → reintegra (braços cruzados) → descruza → desintegra (parado) → …
import { envName } from './brand.js';
// - Ajuste fino da animação ( só afeta TTY). O dono mexe aqui.
export const ANIM = {
  frameMs: 55, //            ms entre quadros
  integrateFrames: 34, //    quadros da integração (chuva assentando no corpo)
  holdFrames: 18, //         quadros parado entre fases
  morphFrames: 4, //         quadros por pose intermediária (cruzar/descruzar)
  morphGlitchFrames: 2, //   desses, quantos mostram o "glitch" nas células que mudam
  disintegrateFrames: 40, // quadros da desintegração (pixels viram código e caem)
  emptyFrames: 12, //        quadros só com chuva antes de reintegrar
  glitchWindow: 0.22, //     fração do tempo em que o pixel fica "código" antes de virar sólido
  fallSpeed: 34, //          linhas por unidade de tempo na queda da desintegração
  ambientColumns: 9, //      colunas de chuva de fundo
  shimmer: 2, //             pixels piscando por quadro quando parado (0 = desliga)
  settleSeed: 42, //         seed do frame final (o estático)
};

const MATRIX_CHARS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾜﾝ0123456789';

// ─── Sprite ────────────────────────────────────────────────────────────
// 1 caractere do sprite = 1 pixel = 2 colunas no terminal (corrige o aspecto 2:1).
//   .  vazio          H  cabelo        S  pele        s  pele (sombra)
//   G  óculos         B  barba         T  camisa      E  borda da camisa
//   P  calça          K  sapato
const HEAD_AND_TORSO = [
  '......HHHHHHHH......',
  '.....HHSSSSSSHH.....',
  '.....HGGGSSGGGH.....',
  '.....SGsGSSGsGS.....',
  '.....SSSSssSSSS.....',
  '.....sSBBBBBBSs.....',
  '......BBSSSSBB......',
  '......BBBBBBBB......',
  '.......BBBBBB.......',
  '....EETTsSSsTTEE....',
  '...ETTTTTsSTTTTTE...',
  '..ETTTTTTTTTTTTTTE..',
  '..ETTTTTTTTTTTTTTE..',
] as const;

const LEGS = [
  '.....PPPP..PPPP.....',
  '.....PPPP..PPPP.....',
  '.....PPPP..PPPP.....',
  '.....PPPP..PPPP.....',
  '.....PPPP..PPPP.....',
  '....EPPPP..PPPPE....',
  '...KKKKKK..KKKKKK...',
] as const;

/** Só o bloco dos braços muda entre as poses. */
const ARMS = {
  idle: [
    '.SSSTTTTTTTTTTTTSSS.',
    '.SSS.TTTTTTTTTT.SSS.',
    '.SSS.TTTTTTTTTT.SSS.',
    '.sSS.TTTTTTTTTT.SSs.',
    '..SS.TTTTTTTTTT.SS..',
    '.SSS.PPPPPPPPPP.SSS.',
    '.SsS.PPPPPPPPPP.SsS.',
    '.S.S.PPPP..PPPP.S.S.',
  ],
  mid: [
    '.SSSTTTTTTTTTTTTSSS.',
    '.SSSSTTTTTTTTTTSSSS.',
    '..SSSSTTTTTTTTSSSS..',
    '....SSSSTTTTSSSS....',
    '.....TTTTTTTTTT.....',
    '.....PPPPPPPPPP.....',
    '.....PPPPPPPPPP.....',
    '.....PPPP..PPPP.....',
  ],
  crossed: [
    '.SSETTTTTTTTTTTTESS.',
    '.SSSSSSSSSSSTTTTSSS.',
    '.SSSSSSSssSSSSSSSSS.',
    '.SSSTTTTSSSSSSSSSSS.',
    '.....TTTTTTTTTT.....',
    '.....PPPPPPPPPP.....',
    '.....PPPPPPPPPP.....',
    '.....PPPP..PPPP.....',
  ],
} as const;

export type Pose = keyof typeof ARMS;

const SPRITES: Record<Pose, readonly string[]> = {
  idle: [...HEAD_AND_TORSO, ...ARMS.idle, ...LEGS],
  mid: [...HEAD_AND_TORSO, ...ARMS.mid, ...LEGS],
  crossed: [...HEAD_AND_TORSO, ...ARMS.crossed, ...LEGS],
};

export const SPRITE_W = HEAD_AND_TORSO[0].length;
export const SPRITE_H = SPRITES.idle.length;

// Falha cedo se alguém editar o sprite e quebrar a largura.
for (const [pose, rows] of Object.entries(SPRITES)) {
  rows.forEach((row, i) => {
    if (row.length !== SPRITE_W) {
      throw new Error(`sprite "${pose}" linha ${i}: largura ${row.length}, esperado ${SPRITE_W}`);
    }
  });
}

// ─── Paleta ────────────────────────────────────────────────────────────
type PixelKind = 'H' | 'S' | 's' | 'G' | 'B' | 'T' | 'E' | 'P' | 'K';
type GlyphTone = 'head' | 'bright' | 'green' | 'dim';
export type Tone = PixelKind | GlyphTone;

/** ansi = terminal 256 cores · mono = sem cor (forma ainda legível) · hex = preview web */
export const PALETTE: Record<Tone, { ansi: string; mono: string; hex: string }> = {
  H: { ansi: '\x1b[38;5;23m', mono: '▓▓', hex: '#0e4a5c' },
  S: { ansi: '\x1b[38;5;119m', mono: '██', hex: '#7cf05a' },
  s: { ansi: '\x1b[38;5;77m', mono: '▓▓', hex: '#3fc85a' },
  G: { ansi: '\x1b[38;5;17m', mono: '░░', hex: '#0a1f4a' },
  B: { ansi: '\x1b[38;5;71m', mono: '▓▓', hex: '#3aa860' },
  T: { ansi: '\x1b[38;5;18m', mono: '▒▒', hex: '#0c2a66' },
  E: { ansi: '\x1b[38;5;30m', mono: '▓▓', hex: '#11907a' },
  P: { ansi: '\x1b[38;5;24m', mono: '▒▒', hex: '#0d3870' },
  K: { ansi: '\x1b[38;5;41m', mono: '▓▓', hex: '#2fd67a' },
  head: { ansi: '\x1b[1;38;5;157m', mono: '', hex: '#d8ffd0' },
  bright: { ansi: '\x1b[92m', mono: '', hex: '#5dff6a' },
  green: { ansi: '\x1b[32m', mono: '', hex: '#1fae3a' },
  dim: { ansi: '\x1b[90m', mono: '', hex: '#1d5a2a' },
};

const RESET = '\x1b[0m';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

// ─── PRNG ──────────────────────────────────────────────────────────────
/** PRNG determinístico (mulberry32) — mesma seed, mesma saída sempre. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pickChar(rand: () => number, s: string): string {
  return s[Math.floor(rand() * s.length)] ?? ' ';
}

/** Ruído estável por célula (mesma célula + salt → mesmo valor em todo quadro). */
function noise(r: number, c: number, salt: number): number {
  return mulberry32((Math.imul(r, 73856093) ^ Math.imul(c, 19349663) ^ salt) >>> 0)();
}

// ─── Grade ─────────────────────────────────────────────────────────────
/** Célula = 2 colunas de terminal. `glyph` vazio + `solid` = bloco de cor. */
export interface Cell {
  glyph: string;
  tone: Tone | null;
  solid: boolean;
}

export interface Canvas {
  cols: number; // em células (cada uma = 2 colunas de terminal)
  rows: number;
  cells: Cell[][];
  top: number; //  onde o sprite começa
  left: number;
}

const EMPTY: Cell = { glyph: '', tone: null, solid: false };

function createCanvas(width: number, height: number): Canvas {
  const cols = Math.floor(width / 2);
  return {
    cols,
    rows: height,
    cells: Array.from({ length: height }, () => Array.from({ length: cols }, () => EMPTY)),
    top: Math.max(0, Math.floor((height - SPRITE_H) / 2)),
    left: Math.max(0, Math.floor((cols - SPRITE_W) / 2)),
  };
}

function inside(cv: Canvas, r: number, c: number): boolean {
  return r >= 0 && r < cv.rows && c >= 0 && c < cv.cols;
}

/** Pinta código (katakana) só onde não há pixel sólido — a chuva nunca pisa no corpo. */
function paintGlyph(cv: Canvas, r: number, c: number, tone: GlyphTone, rand: () => number): void {
  if (!inside(cv, r, c) || cv.cells[r][c].solid) return;
  cv.cells[r][c] = { glyph: pickChar(rand, MATRIX_CHARS), tone, solid: false };
}

function paintSolid(cv: Canvas, r: number, c: number, kind: PixelKind): void {
  if (inside(cv, r, c)) cv.cells[r][c] = { glyph: '', tone: kind, solid: true };
}

function forEachPixel(pose: Pose, fn: (r: number, c: number, kind: PixelKind) => void): void {
  const rows = SPRITES[pose];
  for (let r = 0; r < SPRITE_H; r++) {
    for (let c = 0; c < SPRITE_W; c++) {
      const ch = rows[r][c];
      if (ch !== '.') fn(r, c, ch as PixelKind);
    }
  }
}

/**
 * Quando cada pixel "chega" (integração) ou "solta" (desintegração), em 0..1.
 * De cima pra baixo como a chuva, com ruído pra não ficar uma linha reta.
 */
function threshold(r: number, c: number, salt: number): number {
  return (r / (SPRITE_H - 1)) * 0.7 + noise(r, c, salt) * 0.3;
}

// ─── Camadas ───────────────────────────────────────────────────────────
/** Chuva de fundo contínua. `g` = contador global de quadros (não reinicia por fase). */
function paintAmbientRain(cv: Canvas, g: number, density: number, avoidSprite = false): void {
  const layout = mulberry32(ANIM.settleSeed ^ 0x51ed);
  const total = Math.round(ANIM.ambientColumns * density);
  for (let n = 0; n < total; n++) {
    const col = randInt(layout, 0, cv.cols - 1);
    const speed = 0.35 + layout() * 0.6;
    const len = randInt(layout, 4, 11);
    const span = cv.rows + len;
    const head = Math.floor((g * speed + layout() * span) % span);
    const flicker = mulberry32((g * 131 + n * 977) >>> 0);
    // Com o corpo montado, a chuva passa por trás da silhueta inteira (como no logo):
    // senão ela vaza pelos vãos do sprite (entre as pernas) e vira uma listra no corpo.
    if (avoidSprite && col >= cv.left - 1 && col <= cv.left + SPRITE_W) continue;
    for (let i = 0; i < len; i++) {
      const tone: GlyphTone = i === 0 ? 'bright' : i < 3 ? 'green' : 'dim';
      paintGlyph(cv, head - i, col, tone, flicker);
    }
  }
}

function paintPose(cv: Canvas, pose: Pose): void {
  forEachPixel(pose, (r, c, kind) => paintSolid(cv, cv.top + r, cv.left + c, kind));
}

/** Integração: cada pixel desce como código e "trava" em cor sólida. */
function paintIntegrate(cv: Canvas, pose: Pose, t: number, rand: () => number): void {
  const W = ANIM.glitchWindow;
  const pending: [number, number, number][] = [];
  forEachPixel(pose, (r, c, kind) => {
    const th = threshold(r, c, 0x1a7e);
    if (t >= th + W) paintSolid(cv, cv.top + r, cv.left + c, kind);
    else if (t >= th) pending.push([r, c, (t - th) / W]);
  });
  // Depois dos sólidos, pra o rastro não sobrescrever o corpo já formado.
  for (const [r, c, k] of pending) {
    const R = cv.top + r;
    const C = cv.left + c;
    paintGlyph(cv, R, C, k < 0.35 ? 'head' : 'bright', rand);
    const trail = Math.round((1 - k) * 4);
    for (let i = 1; i <= trail; i++) paintGlyph(cv, R - i, C, i === 1 ? 'green' : 'dim', rand);
  }
}

/** Desintegração: o pixel vira código no lugar e depois escorre pra baixo, apagando. */
function paintDisintegrate(cv: Canvas, pose: Pose, t: number, rand: () => number): void {
  const W = ANIM.glitchWindow;
  const falling: [number, number, number][] = [];
  forEachPixel(pose, (r, c, kind) => {
    const th = threshold(r, c, 0xd15e);
    if (t < th) paintSolid(cv, cv.top + r, cv.left + c, kind);
    else falling.push([r, c, t - th]);
  });
  for (const [r, c, d] of falling) {
    const R = cv.top + r;
    const C = cv.left + c;
    if (d < W) {
      paintGlyph(cv, R, C, d < W / 2 ? 'head' : 'bright', rand);
      continue;
    }
    const fall = Math.floor((d - W) * ANIM.fallSpeed);
    if (R + fall >= cv.rows) continue;
    const tone: GlyphTone = fall < 4 ? 'bright' : fall < 10 ? 'green' : 'dim';
    // Some com probabilidade crescente → os grãos rareiam enquanto caem.
    if (noise(r, c, fall) < fall / 22) continue;
    paintGlyph(cv, R + fall, C, tone, rand);
    if (fall > 0) paintGlyph(cv, R + fall - 1, C, 'dim', rand);
  }
}

/** Troca de pose: só as células que mudam "glitcham" em código por um instante. */
function paintMorph(cv: Canvas, from: Pose, to: Pose, i: number, rand: () => number): void {
  paintPose(cv, i === 0 ? from : to);
  if (i >= ANIM.morphGlitchFrames) return;
  const a = SPRITES[from];
  const b = SPRITES[to];
  for (let r = 0; r < SPRITE_H; r++) {
    for (let c = 0; c < SPRITE_W; c++) {
      if (a[r][c] === b[r][c]) continue;
      const R = cv.top + r;
      const C = cv.left + c;
      cv.cells[R][C] = EMPTY; // libera a célula pro glifo
      paintGlyph(cv, R, C, rand() < 0.4 ? 'head' : 'bright', rand);
    }
  }
}

/** Parado: alguns pixels piscam em código, pra parecer "vivo". */
function paintShimmer(cv: Canvas, pose: Pose, rand: () => number): void {
  const pixels: [number, number][] = [];
  forEachPixel(pose, (r, c) => pixels.push([r, c]));
  for (let n = 0; n < ANIM.shimmer; n++) {
    const [r, c] = pixels[Math.floor(rand() * pixels.length)];
    const R = cv.top + r;
    const C = cv.left + c;
    cv.cells[R][C] = EMPTY;
    paintGlyph(cv, R, C, 'green', rand);
  }
}

// ─── Linha do tempo ────────────────────────────────────────────────────
export type Step =
  | { kind: 'integrate' | 'hold' | 'disintegrate'; pose: Pose }
  | { kind: 'morph'; from: Pose; to: Pose }
  | { kind: 'empty' };

/** Ida: integra parado → cruza → desintegra cruzado. Volta: o inverso. */
export const CYCLE: readonly Step[] = [
  { kind: 'integrate', pose: 'idle' },
  { kind: 'hold', pose: 'idle' },
  { kind: 'morph', from: 'idle', to: 'mid' },
  { kind: 'morph', from: 'mid', to: 'crossed' },
  { kind: 'hold', pose: 'crossed' },
  { kind: 'disintegrate', pose: 'crossed' },
  { kind: 'empty' },
  { kind: 'integrate', pose: 'crossed' },
  { kind: 'hold', pose: 'crossed' },
  { kind: 'morph', from: 'crossed', to: 'mid' },
  { kind: 'morph', from: 'mid', to: 'idle' },
  { kind: 'hold', pose: 'idle' },
  { kind: 'disintegrate', pose: 'idle' },
  { kind: 'empty' },
];

export function stepFrames(step: Step): number {
  switch (step.kind) {
    case 'integrate':
      return ANIM.integrateFrames;
    case 'hold':
      return ANIM.holdFrames;
    case 'morph':
      return ANIM.morphFrames;
    case 'disintegrate':
      return ANIM.disintegrateFrames;
    case 'empty':
      return ANIM.emptyFrames;
  }
}

/** Progresso 0..1 do quadro `i` de `n`, esticado pra caber a janela de glitch / a queda. */
function progress(i: number, n: number, extra: number): number {
  return (n <= 1 ? 1 : i / (n - 1)) * (1 + extra);
}

/**
 * Núcleo puro: monta o quadro `i` do passo `step`. `g` = quadro global
 * (mantém a chuva de fundo contínua entre fases).
 */
export function buildFrame(step: Step, i: number, g: number, width = 70, height = 32): Canvas {
  const cv = createCanvas(width, height);
  const rand = mulberry32((ANIM.settleSeed + g * 0x9e37) >>> 0);
  const n = stepFrames(step);
  const busy = step.kind === 'integrate' || step.kind === 'disintegrate';
  paintAmbientRain(cv, g, busy ? 1.6 : 1, step.kind === 'hold' || step.kind === 'morph');

  switch (step.kind) {
    case 'integrate':
      paintIntegrate(cv, step.pose, progress(i, n, ANIM.glitchWindow), rand);
      break;
    case 'disintegrate':
      paintDisintegrate(cv, step.pose, progress(i, n, ANIM.glitchWindow + 0.75), rand);
      break;
    case 'morph':
      paintMorph(cv, step.from, step.to, i, rand);
      break;
    case 'hold':
      paintPose(cv, step.pose);
      if (ANIM.shimmer > 0) paintShimmer(cv, step.pose, rand);
      break;
    case 'empty':
      break;
  }
  return cv;
}

// ─── Terminal ──────────────────────────────────────────────────────────
function serialize(cv: Canvas, colored: boolean): string {
  const lines: string[] = [];
  for (const row of cv.cells) {
    let line = '';
    for (const cell of row) {
      if (!cell.tone) {
        line += '  ';
        continue;
      }
      const p = PALETTE[cell.tone];
      const text = cell.solid ? (colored ? '██' : p.mono) : `${cell.glyph} `;
      line += colored ? `${p.ansi}${text}${RESET}` : text;
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

export interface MatrixCharacterOptions {
  width?: number;
  height?: number;
  /** Pose do frame estático. Default: `idle`. */
  pose?: Pose;
  /** Default: `true` só quando a saída é um TTY (evita sujar log/arquivo com ANSI). */
  colored?: boolean;
  /** Quantos ciclos completos tocar. Default: infinito (Ctrl+C sai limpo). */
  loops?: number;
}

function dims(opts: MatrixCharacterOptions): { width: number; height: number } {
  return { width: opts.width ?? 70, height: opts.height ?? 32 };
}

/** O personagem estático (pose assentada). Determinístico: mesma seed, mesma saída. */
export function renderMatrixCharacter(opts: MatrixCharacterOptions = {}): string {
  const { width, height } = dims(opts);
  const colored = opts.colored ?? Boolean(process.stdout.isTTY);
  const cv = createCanvas(width, height);
  paintAmbientRain(cv, ANIM.settleSeed, 1, true);
  paintPose(cv, opts.pose ?? 'idle');
  return serialize(cv, colored);
}

/**
 * Vale desenhar agora? O personagem é **para humano em terminal**. Fora de TTY
 * (pipe, captura por agente, CI) ele vira ruído — mesma regra do logo.
 */
export function shouldDrawCharacter(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.CI;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function animationDisabled(width: number, height: number): boolean {
  return (
    !process.stdout.isTTY ||
    Boolean(process.env.CI) ||
    Boolean(process.env[envName('NO_ANIM')]) ||
    (process.stdout.rows ?? 24) < height + 2 ||
    (process.stdout.columns ?? 80) < width
  );
}

/**
 * Toca o ciclo integra → cruza → desintegra → reintegra → descruza → desintegra.
 * Fora de TTY / com `NIO_NO_ANIM` / `CI` / terminal pequeno → só o estático.
 * Com `loops` finito, termina reintegrando e deixa o personagem parado na tela.
 */
export async function animateMatrixCharacter(opts: MatrixCharacterOptions = {}): Promise<void> {
  const { width, height } = dims(opts);
  if (animationDisabled(width, height)) {
    if (shouldDrawCharacter()) process.stdout.write(renderMatrixCharacter(opts) + '\n');
    return;
  }

  const out = process.stdout;
  const colored = opts.colored ?? true;
  const loops = opts.loops ?? Infinity;
  const up = `\x1b[${height}A`;
  let g = 0;

  // Linhas com `trimEnd` não apagam o que sobrou do quadro anterior → `\x1b[K` limpa o resto.
  const draw = (cv: Canvas): void => {
    const frame = serialize(cv, colored).split('\n').join('\x1b[K\n');
    out.write((g === 0 ? '' : up) + frame + '\x1b[K\n');
    g++;
  };
  const play = async (step: Step): Promise<void> => {
    for (let i = 0, n = stepFrames(step); i < n; i++) {
      draw(buildFrame(step, i, g, width, height));
      await sleep(ANIM.frameMs);
    }
  };

  const restore = (): void => {
    out.write(SHOW_CURSOR);
  };
  const onSigint = (): void => {
    restore();
    out.write('\n');
    process.exit(130);
  };
  out.write(HIDE_CURSOR);
  process.once('SIGINT', onSigint);

  try {
    for (let l = 0; l < loops; l++) for (const step of CYCLE) await play(step);
    // Assenta: reintegra parado e deixa o frame final na tela.
    await play({ kind: 'integrate', pose: 'idle' });
    draw(buildFrame({ kind: 'hold', pose: 'idle' }, 0, g, width, height));
  } finally {
    process.off('SIGINT', onSigint);
    restore();
  }
}
