import { fetchJson, sleep } from './store.mjs';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

async function one(url, strategy, key) {
  const params = new URLSearchParams({ url, strategy });
  ['performance', 'seo', 'accessibility', 'best-practices'].forEach((c) => params.append('category', c));
  if (key) params.set('key', key);
  const data = await fetchJson(`${ENDPOINT}?${params}`, { timeout: 120000 }, 1);
  const cat = data.lighthouseResult?.categories || {};
  const audits = data.lighthouseResult?.audits || {};
  const score = (c) => (cat[c]?.score == null ? null : Math.round(cat[c].score * 100));
  return {
    url,
    strategy,
    performance: score('performance'),
    seo: score('seo'),
    accessibility: score('accessibility'),
    bestPractices: score('best-practices'),
    lcp: audits['largest-contentful-paint']?.numericValue ?? null,
    cls: audits['cumulative-layout-shift']?.numericValue ?? null,
    inp: audits['interaction-to-next-paint']?.numericValue ?? null,
    failedSeoAudits: Object.values(audits)
      .filter((a) => a.score !== null && a.score < 1 && a.id && /seo|meta|crawl|canonical|robots|hreflang|structured/i.test(a.id))
      .map((a) => a.title)
      .slice(0, 10)
  };
}

/** Mobile only, priority pages only — 25k free calls a day is plenty but each takes ~30s. */
export async function collect(site) {
  const key = process.env.PAGESPEED_API_KEY || '';
  const results = [];
  for (const p of site.priorityPages) {
    const url = new URL(p, site.domain).toString();
    try {
      results.push(await one(url, 'mobile', key));
    } catch (err) {
      results.push({ url, strategy: 'mobile', error: String(err.message).slice(0, 200) });
    }
    await sleep(2000);
  }
  const scored = results.filter((r) => r.performance != null);
  return {
    pages: results,
    avgPerformance: scored.length ? Math.round(scored.reduce((s, r) => s + r.performance, 0) / scored.length) : null,
    avgSeo: scored.length ? Math.round(scored.reduce((s, r) => s + r.seo, 0) / scored.length) : null
  };
}
