/**
 * Logo NIO com efeito Matrix (chuva de katakana) — decorativo, mostrado no
 * `--help` e na tela de login. Determinístico (seed fixa): a mesma "chuva"
 * sempre, sem piscar diferente a cada execução.
 */

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
function placeLogo(width: number, height: number): { cells: string[][]; logoArea: Set<string>; logoR: number; logoC: number } {
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
  return { cells, logoArea, logoR, logoC };
}

/** Colunas de chuva caindo (cabeça brilhante + rastro de pontos), evitando a área do logo. */
function scatterRain(rand: () => number, canvas: Canvas, width: number, height: number, logoC: number, logoW: number): void {
  const cols: number[] = [];
  for (let n = 0; n < 35; n++) {
    const col = randInt(rand, 0, width - 1);
    if (!(col >= logoC - 1 && col <= logoC + logoW)) cols.push(col);
  }

  for (const col of cols) {
    const start = randInt(rand, -10, 3);
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
    const key = `${row},${col}`;
    if (!canvas.logoArea.has(key) && canvas.cells[row][col] === ' ') {
      canvas.cells[row][col] = pickChar(rand, MATRIX_CHARS);
    }
  }
}

/** Colore: logo em verde sólido, chuva/pixels em tons variados de verde (ou sem cor). */
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

export function renderMatrixLogo(opts: MatrixLogoOptions = {}): string {
  const width = opts.width ?? 70;
  const height = opts.height ?? 24;
  const seed = opts.seed ?? 42;
  const colored = opts.colored ?? Boolean(process.stdout.isTTY);

  const rand = mulberry32(seed);
  const { cells, logoArea, logoC } = placeLogo(width, height);
  const canvas: Canvas = { cells, logoArea };

  scatterRain(rand, canvas, width, height, logoC, NIO_LOGO[0].length);
  scatterLoosePixels(rand, canvas, width, height);

  return colorize(rand, canvas, width, height, colored);
}
