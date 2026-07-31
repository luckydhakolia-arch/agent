import { fetchJson, sleep } from './store.mjs';
import { askJson, FAST } from './claude.mjs';

/* ---------------------------------------------------------------------------
 * Each engine returns { text, citations[] }. Add an engine by adding a function
 * here and an entry in config/queries.json.
 * ------------------------------------------------------------------------- */

async function perplexity(prompt) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  const data = await fetchJson('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800
    }),
    timeout: 60000
  });
  return {
    text: data.choices?.[0]?.message?.content || '',
    citations: data.citations || data.search_results?.map((s) => s.url) || []
  };
}

async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }]
    }),
    timeout: 60000
  });
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('\n');
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  return {
    text,
    citations: chunks.map((c) => c.web?.uri).filter(Boolean)
  };
}

async function claudeSearch(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const data = await fetchJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    }),
    timeout: 120000
  });
  const blocks = data.content || [];
  const citations = [];
  blocks.forEach((b) => {
    (b.citations || []).forEach((c) => c.url && citations.push(c.url));
    if (b.type === 'web_search_tool_result') {
      (b.content || []).forEach((r) => r.url && citations.push(r.url));
    }
  });
  return {
    text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    citations: [...new Set(citations)]
  };
}

const ENGINES = { perplexity, gemini, claude: claudeSearch };

/* ------------------------------------------------------------------------- */

const EXTRACT_SYSTEM =
  'You analyse answer-engine responses for brand visibility research. You output only JSON.';

async function extract(answer, site) {
  return askJson(
    `Analyse this answer-engine response about eggs in India.

BRAND WE TRACK: ${site.brand} (aliases: ${site.brandAliases.join(', ')})
COMPETITORS WE TRACK: ${site.competitors.join(', ')}

RESPONSE TEXT:
"""
${answer.text.slice(0, 6000)}
"""

Return this exact JSON shape:
{
  "brandMentioned": true or false,
  "brandRank": integer or null (if several brands are named, which position ours appears in, 1 = first named; null if not mentioned),
  "brandSentiment": "positive" | "neutral" | "negative" | "absent",
  "brandContext": "one short sentence describing how our brand is characterised, or empty string",
  "competitorsMentioned": ["exact competitor names found, in the order they appear"],
  "otherBrandsMentioned": ["any egg brands named that are not in our competitor list"],
  "answerSummary": "one sentence summarising what the engine actually recommended"
}`,
    { model: FAST, system: EXTRACT_SYSTEM, maxTokens: 900 }
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export async function collect(site, queries) {
  const enabled = queries.engines.filter((e) => e.enabled && ENGINES[e.id]);
  const results = [];
  const citationTally = new Map();
  const ownDomain = hostOf(site.domain);

  for (const prompt of queries.prompts) {
    for (const engine of enabled) {
      let record = {
        promptId: prompt.id,
        bucket: prompt.bucket,
        prompt: prompt.text,
        engine: engine.id
      };
      try {
        const answer = await ENGINES[engine.id](prompt.text);
        if (!answer) {
          record.error = 'engine key missing';
        } else {
          const analysis = await extract(answer, site);
          const hosts = [...new Set(answer.citations.map(hostOf).filter(Boolean))];
          hosts.forEach((h) => {
            const entry = citationTally.get(h) || { host: h, count: 0, prompts: [], mentionsBrand: 0 };
            entry.count++;
            if (entry.prompts.length < 8) entry.prompts.push(prompt.id);
            if (analysis.brandMentioned) entry.mentionsBrand++;
            citationTally.set(h, entry);
          });
          record = {
            ...record,
            ...analysis,
            citedHosts: hosts,
            ownDomainCited: hosts.includes(ownDomain),
            answerLength: answer.text.length
          };
        }
      } catch (err) {
        record.error = String(err.message).slice(0, 200);
      }
      results.push(record);
      await sleep(1200);
    }
  }

  const valid = results.filter((r) => !r.error);
  const mentions = valid.filter((r) => r.brandMentioned);

  const competitorTally = {};
  valid.forEach((r) => (r.competitorsMentioned || []).forEach((c) => {
    competitorTally[c] = (competitorTally[c] || 0) + 1;
  }));

  const byBucket = {};
  valid.forEach((r) => {
    byBucket[r.bucket] = byBucket[r.bucket] || { total: 0, mentioned: 0 };
    byBucket[r.bucket].total++;
    if (r.brandMentioned) byBucket[r.bucket].mentioned++;
  });
  Object.values(byBucket).forEach((b) => (b.rate = +(b.mentioned / b.total).toFixed(3)));

  // The payoff: domains answer engines trust for our category that never mention us.
  const citationGap = [...citationTally.values()]
    .filter((c) => c.host !== ownDomain && c.mentionsBrand === 0 && c.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  return {
    enginesUsed: enabled.map((e) => e.id),
    promptsRun: queries.prompts.length,
    responsesCollected: valid.length,
    errors: results.filter((r) => r.error).length,
    mentionRate: valid.length ? +(mentions.length / valid.length).toFixed(3) : 0,
    ownDomainCitationRate: valid.length
      ? +(valid.filter((r) => r.ownDomainCited).length / valid.length).toFixed(3)
      : 0,
    avgBrandRank: mentions.length
      ? +(mentions.filter((m) => m.brandRank).reduce((s, m) => s + m.brandRank, 0) /
          Math.max(1, mentions.filter((m) => m.brandRank).length)).toFixed(2)
      : null,
    sentimentSplit: ['positive', 'neutral', 'negative'].reduce((acc, s) => {
      acc[s] = mentions.filter((m) => m.brandSentiment === s).length;
      return acc;
    }, {}),
    byBucket,
    shareOfVoice: competitorTally,
    topCitedDomains: [...citationTally.values()].sort((a, b) => b.count - a.count).slice(0, 40),
    citationGap,
    responses: results
  };
}
