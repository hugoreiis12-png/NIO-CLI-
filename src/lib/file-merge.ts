import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

export function backupFile(path: string): string {
  const backupPath = `${path}.bak.${Date.now()}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

export function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  if (raw.trim().length === 0) return null;
  return JSON.parse(raw);
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function readToml(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  if (raw.trim().length === 0) return null;
  return parseToml(raw) as Record<string, unknown>;
}

export function writeToml(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyToml(data) + '\n', 'utf-8');
}
