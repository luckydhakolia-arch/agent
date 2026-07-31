import { fetchJson } from './store.mjs';

const API = 'https://api.anthropic.com/v1/messages';
const KEY = process.env.ANTHROPIC_API_KEY;

// Haiku handles extraction and classification; Sonnet writes briefs and drafts.
export const FAST = 'claude-haiku-4-5-20251001';
export const SMART = 'claude-sonnet-5';

export async function ask(prompt, { model = FAST, system, maxTokens = 2000 } = {}) {
  if (!KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  if (system) body.system = system;
  const data = await fetchJson(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    timeout: 90000
  });
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/** Ask for JSON and parse it defensively — models sometimes wrap output in fences. */
export async function askJson(prompt, opts = {}) {
  const raw = await ask(
    prompt + '\n\nRespond with valid JSON only. No preamble, no markdown fences.',
    opts
  );
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = Math.min(
    ...[cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0).concat([0])
  );
  try {
    return JSON.parse(cleaned.slice(start));
  } catch {
    throw new Error('Could not parse JSON from model output: ' + cleaned.slice(0, 300));
  }
}
