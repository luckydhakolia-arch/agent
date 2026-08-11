import { askJson, FAST } from '../lib/claude.mjs';

/**
 * ASCI Addendum II (April 2025): health and nutrition claims made on social
 * media require the person making them to hold relevant credentials. Nothing
 * this engine drafts may reach a publish queue without passing through here.
 */
const HARD_BLOCK = [
  /\bcure[sd]?\b/i, /\btreat(s|ment|ed)?\b/i, /\bprevent(s|ed|ion)?\b/i,
  /\bheal(s|ed|ing)?\b/i, /\bdiagnos/i, /\breverse(s|d)?\b/i,
  /\bmedicin(e|al)\b/i, /\btherapeutic\b/i, /\bclinically proven\b/i,
  /\bdoctor recommended\b/i, /\bboosts? immunity\b/i, /\bdetox/i,
  /\bweight loss\b/i, /\bfat burn/i, /\bdisease\b/i, /\bdeficienc(y|ies)\b/i
];

const SOFT_FLAG = [
  /\bhelps? (with|you|your)\b/i, /\bimproves?\b/i, /\bincreases?\b/i,
  /\bsupports?\b/i, /\bbest for\b/i, /\bguarantee/i, /\b100%\b/,
  /\bscientifically\b/i, /\bstudies show\b/i, /\bproven\b/i
];

export function lint(text) {
  const hard = HARD_BLOCK.filter((r) => r.test(text)).map((r) => String(r));
  const soft = SOFT_FLAG.filter((r) => r.test(text)).map((r) => String(r));
  return {
    verdict: hard.length ? 'blocked' : soft.length ? 'review' : 'pass',
    hardMatches: hard,
    softMatches: soft
  };
}

/** Regex catches the obvious. This catches claims phrased around the rules. */
export async function review(text) {
  const quick = lint(text);
  if (quick.verdict === 'blocked') return { ...quick, aiReview: null };
  try {
    const ai = await askJson(
      `You are checking Indian FMCG marketing copy against ASCI's Guidelines for Advertising of Food & Beverage products, Addendum II (health and nutrition claims on social media, April 2025).

Under those rules, a brand may state factual, verifiable nutrition composition (e.g. "one egg has about 6g of protein"). It may NOT imply that a food treats, prevents, cures or manages a health condition, and any health-benefit claim delivered by a person requires that person to hold relevant credentials.

COPY TO REVIEW:
"""
${text.slice(0, 4000)}
"""

Return JSON:
{
  "compliant": true or false,
  "riskLevel": "none" | "low" | "medium" | "high",
  "problems": [{ "phrase": "the exact offending phrase", "why": "which rule it strains", "rewrite": "a compliant alternative" }],
  "requiresCredentialedPresenter": true or false,
  "note": "one sentence overall"
}`,
      { model: FAST, maxTokens: 1500 }
    );
    return { ...quick, aiReview: ai, verdict: ai.compliant ? quick.verdict : 'review' };
  } catch (err) {
    return { ...quick, aiReview: null, reviewError: String(err.message).slice(0, 160) };
  }
}
