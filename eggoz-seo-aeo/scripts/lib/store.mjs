import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const DATA = path.join(ROOT, 'data');

export function today() {
  // Reports are stamped in IST so the filename matches the working day in India.
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function readJson(relPath, fallback = null) {
  const abs = path.join(ROOT, relPath);
  if (!existsSync(abs)) return fallback;
  try {
    return JSON.parse(await readFile(abs, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(relPath, value) {
  const abs = path.join(ROOT, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return abs;
}

export async function writeText(relPath, value) {
  const abs = path.join(ROOT, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, value, 'utf8');
  return abs;
}

/** Append one dated point to a named time series and cap its length. */
export async function appendHistory(series, point, cap = 400) {
  const hist = (await readJson('data/history.json', {})) || {};
  hist[series] = hist[series] || [];
  const stamp = point.date || today();
  hist[series] = hist[series].filter((p) => p.date !== stamp);
  hist[series].push({ ...point, date: stamp });
  hist[series].sort((a, b) => a.date.localeCompare(b.date));
  if (hist[series].length > cap) hist[series] = hist[series].slice(-cap);
  await writeJson('data/history.json', hist);
  return hist[series];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with timeout and retry — every collector runs unattended, so nothing may hang. */
export async function fetchJson(url, options = {}, retries = 2) {
  const { timeout = 45000, ...rest } = options;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, { ...rest, signal: ac.signal });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : {};
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await sleep(1500 * (attempt + 1));
    }
  }
}
