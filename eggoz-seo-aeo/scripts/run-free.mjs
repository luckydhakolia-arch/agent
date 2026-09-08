import { readJson, writeJson, writeText, appendHistory, today } from './lib/store.mjs';
import * as crawl from './lib/crawl.mjs';
import * as perf from './lib/perf.mjs';
import * as discover from './lib/discover.mjs';
import * as gscOauth from './lib/gsc-oauth.mjs';
import * as aeo from './lib/aeo.mjs';
import * as reddit from './lib/reddit.mjs';
import * as schema from './analysers/schema.mjs';
import * as briefs from './analysers/briefs.mjs';
import * as alert from './lib/alert.mjs';

/**
 * Google-free run. Uses no Google credential of any kind: no Search Console
 * service account, no PageSpeed key, no Gemini key.
 *
 * It degrades by design rather than failing:
 *   no keys at all      -> crawl, performance probe, coverage discovery, schema, llms.txt
 *   + ANTHROPIC_API_KEY -> answer-engine panel via Claude, plus briefs and drafts
 *   + PERPLEXITY_API_KEY-> a second, citation-bearing answer engine
 *
 * Every section that is skipped says so explicitly, so an empty panel is never
 * mistaken for a measured zero.
 */

const step = async (name, fn) => {
  const started = Date.now();
  try {
    const value = await fn();
    console.log(`  ok    ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    return value;
  } catch (err) {
    console.log(`  fail  ${name}: ${err.message}`);
    return { error: String(err.message).slice(0, 300) };
  }
};

const skipped = (reason) => ({ skipped: true, reason });

async function main() {
  const site = await readJson('config/site.json');
  const keywords = await readJson('config/keywords.json');
  const queries = await readJson('config/queries.json');
  const previous = (await readJson('data/latest.json', {})) || {};
  const date = today();

  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasPerplexity = Boolean(process.env.PERPLEXITY_API_KEY);
  const hasGscOauth = gscOauth.isConfigured();

  console.log(`Google-free run for ${site.brand} — ${date}`);
  console.log(`  keys: anthropic=${hasAnthropic ? 'yes' : 'no'} perplexity=${hasPerplexity ? 'yes' : 'no'} gsc-oauth=${hasGscOauth ? 'yes' : 'no'}`);

  // Search Console via OAuth-as-yourself when configured. This needs no service
  // account and no verified owner — only the access you already have. Coverage
  // discovery still runs alongside: one says what you rank for, the other what
  // you have no content for.
  const seo = hasGscOauth
    ? await step('search console (oauth)', () => gscOauth.collect(site, keywords))
    : skipped('Search Console not connected. Run `npm run auth:gsc` to authorise as yourself — no service account or property owner needed.');
  if (seo.skipped) console.log(`  skip  search console — ${seo.reason}`);
  else if (!seo.error) console.log(`        property: ${seo.property} (${seo.auth})`);

  // --- always available, no credentials -----------------------------------
  const technical = await step('site crawl', () => crawl.collect(site));
  const speed = await step('performance probe', () => perf.collect(site));
  const opportunities = await step('coverage discovery', async () =>
    discover.summarise(technical.error ? { pages: [] } : technical, keywords)
  );
  const social = await step('reddit mentions', () => reddit.collect(site));

  // --- answer engines: non-Google only ------------------------------------
  // Prompts are reused verbatim so trends stay comparable with Google-backed runs.
  const engines = [
    { id: 'perplexity', enabled: hasPerplexity },
    { id: 'claude', enabled: hasAnthropic }
  ].filter((e) => e.enabled);

  const answers = engines.length
    ? await step(`answer engines (${engines.map((e) => e.id).join(', ')})`, () =>
        aeo.collect(site, { ...queries, engines })
      )
    : skipped('No non-Google answer-engine key set. Add ANTHROPIC_API_KEY or PERPLEXITY_API_KEY.');
  if (answers.skipped) console.log(`  skip  answer engines — ${answers.reason}`);

  const structured = await step('schema analysis', () =>
    schema.analyse(technical.error ? { pages: [], schemaCoverage: {} } : technical, site)
  );

  // --- generation: needs Anthropic ----------------------------------------
  const content = hasAnthropic
    ? await step('brief and draft generation', () =>
        briefs.generate(seo.skipped || seo.error ? null : seo, answers.skipped || answers.error ? null : answers, site, {
          limit: 8,
          withDrafts: true,
          extraOpportunities: opportunities.error ? [] : discover.toOpportunities(technical, keywords)
        })
      )
    : skipped('ANTHROPIC_API_KEY not set — briefs and drafts need it.');
  if (content.skipped) console.log(`  skip  generation — ${content.reason}`);

  const report = {
    date,
    kind: 'free',
    mode: 'google-free',
    brand: site.brand,
    seo,
    psi: speed,
    crawl: technical,
    discovery: opportunities,
    aeo: answers,
    aeoDate: answers.skipped ? previous.aeoDate || null : date,
    social,
    schema: structured,
    content,
    briefsDate: content.skipped ? previous.briefsDate || null : date,
    previous: { seoTotals: previous.seo?.totals || null }
  };

  report.alerts = alert.evaluate(report, site);
  await alert.send(report.alerts, site);

  if (!seo.skipped && !seo.error && seo.totals) {
    await appendHistory('seo', {
      date,
      clicks: seo.totals.clicks,
      impressions: seo.totals.impressions,
      ctr: seo.totals.ctr,
      avgPosition: seo.totals.avgPosition,
      queryCount: seo.totals.queryCount
    });
  }
  if (!technical.error) {
    await appendHistory('technical', {
      date,
      totalIssues: technical.totalIssues,
      pagesWithIssues: technical.pagesWithIssues,
      pagesCrawled: technical.pagesCrawled
    });
  }
  if (!speed.error && speed.avgTtfbMs != null) {
    await appendHistory('perf', { date, ttfbMs: speed.avgTtfbMs, totalKb: speed.avgTotalKb, issues: speed.totalIssues });
  }
  if (!opportunities.error) {
    await appendHistory('discovery', {
      date,
      coverageGaps: opportunities.coverageGapCount,
      extractabilityGaps: opportunities.extractabilityGapCount
    });
  }
  if (!answers.skipped && !answers.error) {
    await appendHistory('aeo', {
      date,
      mentionRate: answers.mentionRate,
      ownDomainCitationRate: answers.ownDomainCitationRate,
      avgBrandRank: answers.avgBrandRank,
      responsesCollected: answers.responsesCollected
    });
  }

  for (const b of content.briefs || []) {
    if (b.draft) {
      const flag = b.status === 'blocked-asci' ? 'BLOCKED-ASCI-' : '';
      await writeText(`data/drafts/${date}/${flag}${b.id}.md`, b.draft);
    }
  }
  if (structured.llmsTxt) await writeText('data/generated/llms.txt', structured.llmsTxt);

  await writeJson(`data/free/${date}.json`, report);
  await writeJson('data/latest.json', { ...previous, ...report });

  const gaps = opportunities.coverageGapCount ?? 0;
  console.log(
    `Done. ${technical.pagesCrawled || 0} pages crawled, ${gaps} coverage gap(s), ` +
      `${content.briefsGenerated || 0} brief(s), ${report.alerts.length} alert(s).`
  );
}

main().catch((err) => {
  console.error('Google-free run failed:', err);
  process.exit(1);
});
