/**
 * Credential-free opportunity discovery. Replaces the Search Console collector,
 * which needs a service account that only a verified property owner can grant.
 *
 * GSC answers "what do we already rank for?" — nothing free can replace that.
 * What this answers instead is "what are we plainly not covering?", derived from
 * two things we can measure without any credential: the tracked keyword buckets
 * and our own crawl. Every item carries the evidence it was derived from, so a
 * reader can tell these are coverage inferences, not measured demand.
 */

/** Content words worth matching on — drops stopwords and noise. */
const STOP = new Set(['the', 'and', 'for', 'are', 'with', 'from', 'that', 'this', 'you', 'your', 'can', 'how', 'what', 'why', 'per', 'day']);
const words = (s) => String(s).toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) || [];

/**
 * Legal, transactional and account pages are long but are never content
 * opportunities. Without this filter the top "rewrite" candidates on a typical
 * storefront are the privacy policy and the T&Cs, purely because they are wordy.
 */
const BOILERPLATE = /(privacy|terms|conditions|refund|return-policy|shipping-policy|cancellation|disclaimer|cookie|legal|sitemap|cart|checkout|account|login|register|order|track|wishlist|thank-you|404)/i;

const isBoilerplate = (p) => BOILERPLATE.test(p.url || '') || BOILERPLATE.test(p.title || '');

/** Titles come out of the crawl with markup whitespace still in them. */
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** The text a search or answer engine actually sees as this page's topic signals. */
function pageBlob(p) {
  return [p.title, p.description, ...(p.h1 || []), ...(p.h2 || []), ...(p.questionHeadings || [])]
    .filter(Boolean).join(' ').toLowerCase();
}

/** A page covers a term when every content word of the term appears in its signals. */
function covers(blob, term) {
  const ws = words(term);
  return ws.length > 0 && ws.every((w) => blob.includes(w));
}

/**
 * Keyword buckets with no page covering them at all. These are the clearest
 * "we have nothing on this" signals available without ranking data.
 */
export function coverageGaps(crawl, keywords) {
  const blobs = (crawl?.pages || []).filter((p) => !p.error).map(pageBlob);
  const gaps = [];
  for (const [bucket, terms] of Object.entries(keywords?.buckets || {})) {
    for (const term of terms) {
      const hits = blobs.filter((b) => covers(b, term)).length;
      if (hits === 0) gaps.push({ bucket, term });
    }
  }
  return gaps;
}

/**
 * Substantial pages with no question-shaped heading. They already have the
 * content; they are simply not structured the way answer engines lift from.
 */
export function extractabilityGaps(crawl, minWords = 400) {
  return (crawl?.pages || [])
    .filter((p) => !p.error && (p.words || 0) >= minWords && (p.questionHeadings || []).length === 0 && p.title)
    .filter((p) => !isBoilerplate(p))
    .sort((a, b) => (b.words || 0) - (a.words || 0))
    .map((p) => ({ url: p.url, title: clean(p.title), words: p.words, schemaTypes: p.schemaTypes || [] }));
}

/**
 * Emits opportunities in the shape the brief generator ranks, so Google-free
 * runs feed the same pipeline as Search Console-backed ones.
 */
export function toOpportunities(crawl, keywords, { coverageLimit = 12, extractLimit = 8 } = {}) {
  const items = [];

  for (const g of coverageGaps(crawl, keywords).slice(0, coverageLimit)) {
    items.push({
      source: 'gap-coverage',
      topic: g.term,
      bucket: g.bucket,
      evidence: `No page on the site covers "${g.term}" in its title, description or headings — a tracked "${g.bucket}" term with no content behind it`,
      score: 240
    });
  }

  for (const p of extractabilityGaps(crawl).slice(0, extractLimit)) {
    items.push({
      source: 'gap-extractability',
      topic: p.title,
      bucket: 'extractability',
      evidence: `${p.url} has ${p.words} words but no question-shaped heading, so answer engines have no block to lift. Restructure rather than write new`,
      score: 180 + Math.min(60, Math.round(p.words / 40))
    });
  }

  return items;
}

/** Headline counts for the dashboard and the report. */
export function summarise(crawl, keywords) {
  const coverage = coverageGaps(crawl, keywords);
  const extract = extractabilityGaps(crawl);
  const byBucket = {};
  coverage.forEach((g) => { byBucket[g.bucket] = (byBucket[g.bucket] || 0) + 1; });

  return {
    method: 'crawl-derived',
    note: 'Coverage inferred from the sitemap crawl against tracked keyword buckets. Not search demand — Search Console is the only source for that.',
    pagesAnalysed: (crawl?.pages || []).filter((p) => !p.error).length,
    coverageGapCount: coverage.length,
    coverageGapsByBucket: byBucket,
    coverageGaps: coverage,
    extractabilityGapCount: extract.length,
    extractabilityGaps: extract.slice(0, 30)
  };
}
