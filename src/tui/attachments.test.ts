import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { Jimp } from 'jimp';
import { detectPaths, buildAttachedInput } from './attachments.js';

function fixture(): { dir: string; csv: string; txt: string; xlsx: string; spaced: string; png: string } {
  const dir = mkdtempSync(join(tmpdir(), 'nio-attach-'));
  const csv = join(dir, 'dados.csv');
  const txt = join(dir, 'notas.txt');
  const xlsx = join(dir, 'planilha.xlsx');
  const png = join(dir, 'foto.png');
  writeFileSync(csv, 'a,b\n1,2\n');
  writeFileSync(txt, 'conteudo do txt');
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // bytes de PNG
  const sub = join(dir, 'com espaco');
  mkdirSync(sub);
  const spaced = join(sub, 'arq.txt');
  writeFileSync(spaced, 'texto com espaco no path');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x', 'y'], [10, 20]]), 'Plan1');
  XLSX.writeFile(wb, xlsx);
  return { dir, csv, txt, xlsx, spaced, png };
}

test('detectPaths: acha csv/txt/xlsx existentes, ignora inexistente e não-arquivo', () => {
  const { dir, csv, txt, xlsx } = fixture();
  const dets = detectPaths(`resuma ${csv} e ${txt} e ${xlsx} e ${join(dir, 'naoexiste.csv')}`);
  const kinds = dets.map((d) => d.kind).sort();
  expect(kinds).toEqual(['csv', 'txt', 'xlsx']);
  rmSync(dir, { recursive: true, force: true });
});

test('detectPaths: caminho entre aspas com espaço é detectado', () => {
  const { dir, spaced } = fixture();
  const dets = detectPaths(`olha isso "${spaced}" por favor`);
  expect(dets).toHaveLength(1);
  expect(dets[0]!.kind).toBe('txt');
  rmSync(dir, { recursive: true, force: true });
});

test('buildAttachedInput: embute conteúdo dos arquivos e remove o path do texto', async () => {
  const { dir, csv } = fixture();
  const { fileParts, text } = await buildAttachedInput(`resuma ${csv} pra mim`);
  expect(fileParts).toEqual([]); // imagem gated (4b); csv vira texto embutido
  expect(text).toContain('resuma'); // resto do texto do usuário preservado
  expect(text).toContain('pra mim');
  expect(text).not.toContain(csv); // token de path removido do texto
  expect(text).toContain('arquivo anexado: dados.csv');
  expect(text).toContain('a,b'); // conteúdo do csv embutido
  rmSync(dir, { recursive: true, force: true });
});

test('buildAttachedInput: xlsx vira CSV das abas embutido', async () => {
  const { dir, xlsx } = fixture();
  const { text } = await buildAttachedInput(`analisa ${xlsx}`);
  expect(text).toContain('arquivo anexado: planilha.xlsx');
  expect(text).toContain('x,y'); // cabeçalho da planilha como CSV
  expect(text).toContain('10,20'); // dados
  rmSync(dir, { recursive: true, force: true });
});

test('buildAttachedInput: imagem vira FilePartInput data-URI (Item 4b)', async () => {
  const { dir, png } = fixture();
  const { fileParts, text } = await buildAttachedInput(`o que tem nessa imagem ${png}`);
  expect(fileParts).toHaveLength(1);
  expect(fileParts[0]!.type).toBe('file');
  expect(fileParts[0]!.mime).toBe('image/png');
  expect(fileParts[0]!.filename).toBe('foto.png');
  expect(fileParts[0]!.url.startsWith('data:image/png;base64,')).toBe(true);
  expect(text).not.toContain(png); // path removido do texto
  expect(text).toContain('o que tem nessa imagem');
  rmSync(dir, { recursive: true, force: true });
});

test('buildAttachedInput: arquivo grande NÃO-imagem (lixo) → aviso rápido, sem travar o jimp', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nio-attach-big-'));
  const big = join(dir, 'grande.png');
  writeFileSync(big, Buffer.alloc(2_000_000, 1)); // 2 MB de lixo (sem assinatura de imagem) > teto
  const { fileParts, text } = await buildAttachedInput(`analisa ${big}`);
  expect(fileParts).toEqual([]); // guard de assinatura → não vira part
  expect(text).toContain('grande demais');
  expect(text).toContain('grande.png');
  rmSync(dir, { recursive: true, force: true });
});

test('buildAttachedInput: imagem acima do teto é REDUZIDA (downscale) → part jpeg', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nio-attach-ds-'));
  const p = join(dir, 'foto.png');
  const img = new Jimp({ width: 512, height: 512 });
  for (let i = 0; i < img.bitmap.data.length; i++) img.bitmap.data[i] = (Math.random() * 256) | 0; // ruído real → png grande
  await img.write(p as `${string}.png`);
  // teto força o downscale; a versão reduzida (64px jpeg) cabe folgado
  const { fileParts, text } = await buildAttachedInput(`veja ${p}`, { maxImageBytes: 100_000, maxDim: 64 });
  expect(fileParts).toHaveLength(1);
  expect(fileParts[0]!.mime).toBe('image/jpeg'); // re-encodada ao reduzir
  expect(fileParts[0]!.url.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(text).not.toContain('grande demais'); // reduziu, não barrou
  rmSync(dir, { recursive: true, force: true });
});

test('buildAttachedInput: sem path → texto intacto, sem parts', async () => {
  const { fileParts, text } = await buildAttachedInput('só um texto normal sem arquivo');
  expect(fileParts).toEqual([]);
  expect(text).toBe('só um texto normal sem arquivo');
});
