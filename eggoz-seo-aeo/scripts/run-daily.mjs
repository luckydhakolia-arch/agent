import { readJson, writeJson, appendHistory, today } from './lib/store.mjs';
import * as gsc from './lib/gsc.mjs';
import * as psi from './lib/psi.mjs';
import * as crawl from './lib/crawl.mjs';
import * as alert from './lib/alert.mjs';

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

async function main() {
  const site = await readJson('config/site.json');
  const keywords = await readJson('config/keywords.json');
  const date = today();
  const previous = await readJson('data/latest.json', {});

  console.log(`Daily run for ${site.brand} — ${date}`);

  const seo = await step('search console', () => gsc.collect(site, keywords));
  const speed = await step('pagespeed', () => psi.collect(site));
  const technical = await step('site crawl', () => crawl.collect(site));

  const report = {
    date,
    kind: 'daily',
    brand: site.brand,
    seo,
    psi: speed,
    crawl: technical,
    // Carried forward so the weekly run and the dashboard keep AEO context.
    aeo: previous.aeo || null,
    aeoDate: previous.aeoDate || null,
    briefsDate: previous.briefsDate || null,
    previous: { seoTotals: previous.seo?.totals || null }
  };

  report.alerts = alert.evaluate(report, site);
  await alert.send(report.alerts, site);

  if (!seo.error && seo.totals) {
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
  if (!speed.error && speed.avgPerformance != null) {
    await appendHistory('speed', { date, performance: speed.avgPerformance, seo: speed.avgSeo });
  }

  // The dated file is this run's self-contained snapshot. latest.json is the
  // shared view the dashboard reads, so it must MERGE: overwriting it would
  // discard the weekly run's social, schema and content sections every day.
  await writeJson(`data/daily/${date}.json`, report);
  await writeJson('data/latest.json', { ...previous, ...report });

  console.log(`Done. ${report.alerts.length} alert(s).`);
}

main().catch((err) => {
  console.error('Daily run failed:', err);
  process.exit(1);
});
