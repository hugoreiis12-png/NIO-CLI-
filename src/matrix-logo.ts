/**
 * Logo NIO com efeito Matrix. `renderMatrixLogo()` = frame estático; `animateMatrixLogo()`
 * toca a chuva caindo (~1.3s) e assenta nele — só em TTY (fallback estático fora,
 * ou com `NIO_NO_ANIM=1`).
 */
import { envName } from './brand.js';

// ─── Ajuste fino da animação (só afeta TTY). O dono mexe aqui. ─────────
const ANIM = {
  frames: 30, //     nº de quadros da chuva caindo
  frameMs: 45, //    ms entre quadros  (30 * 45 ≈ 1.35s)
  rainColumns: 42, // colunas de chuva por quadro (densidade)
  settleSeed: 42, //  seed do frame final (o estático)
};

const MATRIX_CHARS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾜﾝ0123456789';
const TRAIL_CHARS = '･｡';

const NIO_LOGO = [
  '███╗   ██╗██╗ ██████╗ ',
  '████╗  ██║██║██╔═══██╗',
  '██╔██╗ ██║██║██║   ██║',
  '██║╚██╗██║██║██║   ██║',
  '██║ ╚████║██║╚██████╔╝',
  '╚═╝  ╚═══╝╚═╝ ╚═════╝ ',
] as const;

const RESET = '\x1b[0m';
const LOGO_COLOR = '\x1b[1;32m';
const BRIGHT = '\x1b[92m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[90m';

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

interface Canvas {
  cells: string[][];
  logoArea: Set<string>;
}

/** Desenha o logo centralizado e devolve o retângulo ocupado (a chuva não pisa nele). */
function placeLogo(width: number, height: number): Canvas & { logoC: number } {
  const cells = Array.from({ length: height }, () => Array<string>(width).fill(' '));
  const logoH = NIO_LOGO.length;
  const logoW = NIO_LOGO[0].length;
  const logoR = Math.floor((height - logoH) / 2);
  const logoC = Math.floor((width - logoW) / 2);
  const logoArea = new Set<string>();

  for (let i = 0; i < logoH; i++) {
    for (let j = 0; j < logoW; j++) {
      cells[logoR + i][logoC + j] = NIO_LOGO[i][j];
      logoArea.add(`${logoR + i},${logoC + j}`);
    }
  }
  return { cells, logoArea, logoC };
}

/**
 * Colunas de chuva (cabeça brilhante + rastro de pontos), evitando a área do logo.
 * `fall` desloca todas as colunas pra baixo — `< 0` = chuva ainda "acima" da tela
 * (usado nos primeiros quadros da animação).
 */
function scatterRain(
  rand: () => number,
  canvas: Canvas,
  width: number,
  height: number,
  logoC: number,
  logoW: number,
  fall: number,
): void {
  const cols: number[] = [];
  for (let n = 0; n < ANIM.rainColumns; n++) {
    const col = randInt(rand, 0, width - 1);
    if (!(col >= logoC - 1 && col <= logoC + logoW)) cols.push(col);
  }

  for (const col of cols) {
    const start = randInt(rand, -10, 3) + fall;
    const trail = randInt(rand, 6, 18);
    for (let i = 0; i < trail; i++) {
      const row = start + i;
      const key = `${row},${col}`;
      if (row < 0 || row >= height || canvas.logoArea.has(key)) continue;
      canvas.cells[row][col] = i >= trail - 4 ? pickChar(rand, MATRIX_CHARS) : pickChar(rand, TRAIL_CHARS);
    }
  }
}

/** Pixels soltos, pra preencher o fundo sem ficar tão vazio. */
function scatterLoosePixels(rand: () => number, canvas: Canvas, width: number, height: number): void {
  for (let n = 0; n < 50; n++) {
    const row = randInt(rand, 0, height - 1);
    const col = randInt(rand, 0, width - 1);
    if (!canvas.logoArea.has(`${row},${col}`) && canvas.cells[row][col] === ' ') {
      canvas.cells[row][col] = pickChar(rand, MATRIX_CHARS);
    }
  }
}

/** Colore: logo em verde sólido, chuva/pixels em tons variados de verde. */
function colorize(rand: () => number, canvas: Canvas, width: number, height: number, colored: boolean): string {
  const lines: string[] = [];
  for (let r = 0; r < height; r++) {
    let line = '';
    for (let c = 0; c < width; c++) {
      const ch = canvas.cells[r][c];
      if (ch === ' ') {
        line += ' ';
      } else if (canvas.logoArea.has(`${r},${c}`)) {
        line += colored ? `${LOGO_COLOR}${ch}${RESET}` : ch;
      } else if (colored) {
        const roll = rand();
        const color = roll < 0.25 ? BRIGHT : roll < 0.6 ? GREEN : DIM;
        line += `${color}${ch}${RESET}`;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export interface MatrixLogoOptions {
  width?: number;
  height?: number;
  seed?: number;
  /** Default: `true` só quando a saída é um TTY (evita sujar log/arquivo com ANSI). */
  colored?: boolean;
}

/** Um quadro. `fall` desloca a chuva (0 = assentado). */
function renderFrame(opts: MatrixLogoOptions, seed: number, fall: number): string {
  const width = opts.width ?? 70;
  const height = opts.height ?? 24;
  const colored = opts.colored ?? Boolean(process.stdout.isTTY);

  const rand = mulberry32(seed);
  const canvas = placeLogo(width, height);
  scatterRain(rand, canvas, width, height, canvas.logoC, NIO_LOGO[0].length, fall);
  scatterLoosePixels(rand, canvas, width, height);
  return colorize(rand, canvas, width, height, colored);
}

/** O logo estático (frame assentado). Determinístico: mesma seed, mesma saída. */
export function renderMatrixLogo(opts: MatrixLogoOptions = {}): string {
  return renderFrame(opts, opts.seed ?? ANIM.settleSeed, 0);
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
 * Toca a chuva caindo e assenta no logo. Fora de TTY / com `NIO_NO_ANIM` / `CI` /
 * terminal baixo demais → só imprime o estático uma vez. Deixa o frame final na tela.
 */
export async function animateMatrixLogo(opts: MatrixLogoOptions = {}): Promise<void> {
  const width = opts.width ?? 70;
  const height = opts.height ?? 24;
  if (animationDisabled(width, height)) {
    process.stdout.write(renderMatrixLogo(opts) + '\n');
    return;
  }

  const up = `\x1b[${height}A`;
  for (let f = 0; f <= ANIM.frames; f++) {
    const last = f === ANIM.frames;
    const seed = last ? (opts.seed ?? ANIM.settleSeed) : (ANIM.settleSeed + f * 0x9e37) >>> 0;
    const frame = last ? renderMatrixLogo(opts) : renderFrame(opts, seed, f - ANIM.frames);
    process.stdout.write((f === 0 ? '' : up) + frame + '\n');
    if (!last) await sleep(ANIM.frameMs);
  }
}
