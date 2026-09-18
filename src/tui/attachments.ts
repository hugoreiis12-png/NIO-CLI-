/**
 * Anexos de arquivo no input: detecta caminhos colados/digitados e monta o payload
 * pro `session.prompt`. Arquivos de texto (csv/txt/xlsx) viram um bloco rotulado
 * embutido no prompt — o map-reduce do `send()` compacta o conjunto se ficar grande.
 * Imagem → `FilePartInput` (data-URI base64), enviada ao modelo multimodal.
 */
import { existsSync, statSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { FilePartInput } from '@opencode-ai/sdk';
import { NIO_AI_MAX_IMAGE_BYTES, NIO_AI_IMAGE_MAX_DIM } from '../lib/clients/client-configs.js';

const fmtMB = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

export type AttachKind = 'image' | 'csv' | 'txt' | 'xlsx';

export interface DetectedPath {
  /** caminho do arquivo (sem aspas). */
  path: string;
  /** token exato como apareceu no texto (com aspas, se havia) — pra remover do texto. */
  token: string;
  kind: AttachKind;
}

const EXT_KIND: Record<string, AttachKind> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
  '.csv': 'csv',
  '.txt': 'txt', '.md': 'txt', '.log': 'txt',
  '.xlsx': 'xlsx', '.xls': 'xlsx',
};

/** Candidatos a caminho: primeiro os entre aspas (podem ter espaço), depois os "soltos". */
function candidates(text: string): { path: string; token: string }[] {
  const out: { path: string; token: string }[] = [];
  let rest = text;
  for (const m of text.matchAll(/"([^"]+)"|'([^']+)'/g)) {
    const path = (m[1] ?? m[2])!;
    out.push({ path, token: m[0] });
    rest = rest.replace(m[0], ' ');
  }
  for (const tok of rest.split(/\s+/)) if (tok) out.push({ path: tok, token: tok });
  return out;
}

/** Caminhos de arquivo existentes no texto, classificados por extensão. Só arquivos. */
export function detectPaths(text: string): DetectedPath[] {
  const found: DetectedPath[] = [];
  for (const { path, token } of candidates(text)) {
    const kind = EXT_KIND[extname(path).toLowerCase()];
    if (!kind) continue;
    try {
      if (existsSync(path) && statSync(path).isFile()) found.push({ path, token, kind });
    } catch {
      /* path inválido → ignora */
    }
  }
  return found;
}

/** Lê um anexo de texto (csv/txt como está; xlsx → CSV de todas as abas). */
async function readAsText(det: DetectedPath): Promise<string> {
  if (det.kind === 'xlsx') {
    const XLSX = await import('xlsx'); // lazy: só carrega SheetJS quando há xlsx
    const wb = XLSX.readFile(det.path);
    return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n]!)).join('\n\n');
  }
  return readFileSync(det.path, 'utf8');
}

/** Remove a 1ª ocorrência do token de path do texto. */
function stripToken(text: string, token: string): string {
  const i = text.indexOf(token);
  return i < 0 ? text : text.slice(0, i) + text.slice(i + token.length);
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

/** Lê uma imagem e monta o `FilePartInput` como data-URI base64 (Item 4b). */
function imagePart(det: DetectedPath): FilePartInput {
  const mime = IMAGE_MIME[extname(det.path).toLowerCase()] ?? 'application/octet-stream';
  const b64 = readFileSync(det.path).toString('base64');
  return { type: 'file', mime, filename: basename(det.path), url: `data:${mime};base64,${b64}` };
}

/**
 * Reduz imagem acima do teto: `scaleToFit(maxDim)` + JPEG q72 → data-URI pequeno.
 * `null` se não deu (arquivo ilegível ou ainda acima do teto). Lazy import do jimp.
 */
async function downscaleImage(
  path: string,
  maxBytes: number,
  maxDim: number,
): Promise<FilePartInput | null> {
  try {
    const { Jimp, JimpMime } = await import('jimp');
    const img = await Jimp.read(path);
    img.scaleToFit({ w: maxDim, h: maxDim });
    const buf = await img.getBuffer(JimpMime.jpeg, { quality: 72 });
    if (maxBytes > 0 && buf.length > maxBytes) return null; // ainda grande → desiste
    return {
      type: 'file', mime: 'image/jpeg', filename: basename(path),
      url: `data:image/jpeg;base64,${buf.toString('base64')}`,
    };
  } catch {
    return null; // jimp não conseguiu ler/reencodar
  }
}

/**
 * Monta o input com anexos: tira os tokens de path do texto e embute o conteúdo dos
 * arquivos de texto como blocos rotulados. `fileParts` (imagens) fica vazio até o
 * Item 4b. `send()` roda o map-reduce sobre o `text` resultante.
 */
export async function buildAttachedInput(
  text: string,
  opts: { maxImageBytes?: number; maxDim?: number } = {},
): Promise<{ fileParts: FilePartInput[]; text: string }> {
  const maxImageBytes = opts.maxImageBytes ?? NIO_AI_MAX_IMAGE_BYTES;
  const maxDim = opts.maxDim ?? NIO_AI_IMAGE_MAX_DIM;
  const dets = detectPaths(text);
  if (dets.length === 0) return { fileParts: [], text };
  let stripped = text;
  const blocks: string[] = [];
  const fileParts: FilePartInput[] = [];
  for (const det of dets) {
    stripped = stripToken(stripped, det.token);
    const name = basename(det.path);
    if (det.kind === 'image') {
      try {
        const size = statSync(det.path).size;
        if (maxImageBytes <= 0 || size <= maxImageBytes) {
          fileParts.push(imagePart(det)); // cabe → manda como está
        } else {
          // grande demais → reduz (downscale) pra caber, em vez de barrar (maximiza input).
          const reduced = await downscaleImage(det.path, maxImageBytes, maxDim);
          if (reduced) fileParts.push(reduced);
          else
            blocks.push(
              `\n\n--- imagem ${name} (${fmtMB(size)}) grande demais e não coube nem reduzida (teto ${fmtMB(maxImageBytes)}) — reduza manualmente ---`,
            );
        }
      } catch {
        blocks.push(`\n\n--- imagem ${name} (falha ao ler) ---`);
      }
      continue;
    }
    try {
      blocks.push(`\n\n--- arquivo anexado: ${name} ---\n${await readAsText(det)}`);
    } catch {
      blocks.push(`\n\n--- arquivo anexado: ${name} (falha ao ler) ---`);
    }
  }
  return { fileParts, text: `${stripped.trim()}${blocks.join('')}` };
}
