import { ask, askJson, SMART, FAST } from '../lib/claude.mjs';
import { review } from './asci.mjs';
import { sleep } from '../lib/store.mjs';

/**
 * Opportunities are ranked before anything is written, because generating
 * drafts for low-value gaps is the fastest way to make this engine expensive
 * and useless. Only the top N get a brief; only briefs get a draft.
 */
function rankOpportunities(seo, aeo, site, limit = 8, extra = []) {
  // Credential-free sources (coverage and extractability gaps) arrive pre-shaped.
  const items = [...extra];

  (seo?.strikingDistance || []).forEach((q) => {
    items.push({
      source: 'gsc-striking',
      topic: q.query,
      bucket: q.bucket,
      evidence: `Position ${q.position}, ${q.impressions} impressions, ${q.clicks} clicks in 28 days`,
      score: q.impressions * (21 - q.position) / 100
    });
  });

  (seo?.weakSnippets || []).forEach((q) => {
    items.push({
      source: 'gsc-ctr',
      topic: q.query,
      bucket: q.bucket,
      evidence: `Ranks ${q.position} with ${q.impressions} impressions but only ${q.ctr}% CTR — the title and description are the problem, not the ranking`,
      score: q.impressions * 0.6
    });
  });

  (seo?.decayed || []).forEach((q) => {
    items.push({
      source: 'gsc-decay',
      topic: q.query,
      bucket: q.bucket,
      evidence: `Dropped ${Math.abs(q.positionDelta)} positions to ${q.position} versus the previous 28 days`,
      score: q.impressions * 0.8
    });
  });

  // AEO buckets where we are invisible are worth more than a marginal SEO win.
  Object.entries(aeo?.byBucket || {}).forEach(([bucket, stats]) => {
    if (stats.rate < 0.3) {
      const prompts = (aeo.responses || [])
        .filter((r) => r.bucket === bucket && !r.brandMentioned && !r.error)
        .slice(0, 3)
        .map((r) => r.prompt);
      if (prompts.length) {
        items.push({
          source: 'aeo-gap',
          topic: prompts[0],
          bucket,
          evidence: `${site.brand} appears in only ${Math.round(stats.rate * 100)}% of answer-engine responses in the "${bucket}" bucket. Related unanswered prompts: ${prompts.slice(1).join('; ') || 'none'}`,
          score: 400 * (1 - stats.rate)
        });
      }
    }
  });

  const seen = new Set();
  return items
    .filter((i) => {
      const k = i.topic.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const BRIEF_SYSTEM = `You are a senior SEO and answer-engine strategist writing briefs for Eggoz, a premium D2C branded egg company in India.

Audience: health-conscious Indian families, not urban fitness enthusiasts. They buy on Blinkit, Zepto, Instamart and eggoz.in across Delhi NCR, Bengaluru, Mumbai, Hyderabad, Kolkata and Jaipur.

Hard constraints:
- ASCI Addendum II applies. State nutrition composition factually. Never claim a food treats, prevents, cures or manages any condition.
- Write for extraction: every H2 should be a real question a person would type or ask, with a direct 40-60 word answer immediately beneath it before any elaboration. That block is what answer engines lift.
- Indian context throughout: rupees, Indian meals, Indian kitchen realities, Indian summer storage.
- No hollow marketing language.`;

async function buildBrief(opp, site) {
  const brief = await askJson(
    `Write a content brief for this opportunity.

TOPIC: ${opp.topic}
WHY IT SURFACED: ${opp.evidence}
BUCKET: ${opp.bucket}
SOURCE SIGNAL: ${opp.source}

Return JSON:
{
  "workingTitle": "the H1, under 60 characters",
  "metaTitle": "SEO title tag, under 60 characters",
  "metaDescription": "under 155 characters, written to earn the click",
  "targetQuery": "the primary query this page answers",
  "secondaryQueries": ["4-6 related queries this page should also capture"],
  "searchIntent": "informational | commercial | transactional | navigational",
  "answerBlock": "a 40-60 word direct answer to the primary query, written so an answer engine can lift it verbatim",
  "outline": [{ "heading": "a question-shaped H2", "answerFirst": "40-60 word direct answer", "covers": ["supporting points beneath it"] }],
  "faqs": [{ "q": "question", "a": "60-80 word answer" }],
  "schemaTypes": ["which schema.org types this page should carry"],
  "internalLinks": ["which other Eggoz pages or topics to link to"],
  "distinctiveAngle": "what Eggoz can say here that a generic article cannot — farm network, freshness window, city coverage, testing",
  "wordCount": integer,
  "priority": "high" | "medium" | "low"
}

Give the outline 5 to 7 headings and 4 to 6 FAQs.`,
    { model: SMART, system: BRIEF_SYSTEM, maxTokens: 3500 }
  );
  return { ...brief, opportunity: opp, site: site.brand };
}

async function buildDraft(brief) {
  const outline = (brief.outline || [])
    .map((s, i) => `${i + 1}. ${s.heading}\n   Answer first: ${s.answerFirst}\n   Then cover: ${(s.covers || []).join(', ')}`)
    .join('\n');
  const faqs = (brief.faqs || []).map((f) => `- ${f.q}`).join('\n');

  return ask(
    `Write the full article from this brief. Output clean Markdown only — no commentary, no code fences.

H1: ${brief.workingTitle}
Primary query: ${brief.targetQuery}
Also capture: ${(brief.secondaryQueries || []).join(', ')}
Target length: ${brief.wordCount || 1200} words
Distinctive angle: ${brief.distinctiveAngle}

Open with this answer block as the first paragraph, refined but not lengthened:
${brief.answerBlock}

Then follow this outline exactly. Under every H2, the first paragraph must be a direct 40-60 word answer to that heading before any elaboration:
${outline}

Close with an H2 "Frequently asked questions" covering:
${faqs}

Remember: ASCI Addendum II. Nutrition composition stated as fact is fine. No claim that eggs treat, prevent, cure or manage any condition. No credentialed-sounding health advice.`,
    { model: SMART, system: BRIEF_SYSTEM, maxTokens: 8000 }
  );
}

export async function generate(seo, aeo, site, { limit = 8, withDrafts = true, extraOpportunities = [] } = {}) {
  const opportunities = rankOpportunities(seo, aeo, site, limit, extraOpportunities);
  const briefs = [];

  for (const opp of opportunities) {
    try {
      const brief = await buildBrief(opp, site);
      let draft = null;
      let compliance = null;

      if (withDrafts && brief.priority !== 'low') {
        draft = await buildDraft(brief);
        compliance = await review(draft);
        // A blocked draft is kept, never silently deleted — you decide, not the script.
        if (compliance.verdict === 'blocked') brief.status = 'blocked-asci';
      }

      briefs.push({
        id: `${opp.source}-${opp.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`,
        status: brief.status || (draft ? 'draft-ready' : 'brief-only'),
        generatedAt: new Date().toISOString(),
        brief,
        draft,
        compliance
      });
    } catch (err) {
      briefs.push({
        id: opp.topic.slice(0, 60),
        status: 'error',
        error: String(err.message).slice(0, 240),
        opportunity: opp
      });
    }
    await sleep(1500);
  }

  return {
    generatedAt: new Date().toISOString(),
    opportunitiesConsidered: opportunities.length,
    briefsGenerated: briefs.filter((b) => b.status !== 'error').length,
    blockedByAsci: briefs.filter((b) => b.status === 'blocked-asci').length,
    briefs
  };
}
