import { readJson, writeJson, writeText, appendHistory, today } from './lib/store.mjs';
import * as aeo from './lib/aeo.mjs';
import * as reddit from './lib/reddit.mjs';
import * as schema from './analysers/schema.mjs';
import * as briefs from './analysers/briefs.mjs';
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
  const queries = await readJson('config/queries.json');
  const latest = await readJson('data/latest.json', {});
  const date = today();

  console.log(`Weekly run for ${site.brand} — ${date}`);

  const answers = await step('answer engines', () => aeo.collect(site, queries));
  const social = await step('reddit mentions', () => reddit.collect(site));
  const structured = await step('schema analysis', () =>
    schema.analyse(latest.crawl || { pages: [], schemaCoverage: {} }, site)
  );
  const content = await step('brief and draft generation', () =>
    briefs.generate(latest.seo, answers.error ? null : answers, site, { limit: 8, withDrafts: true })
  );

  const report = { date, kind: 'weekly', brand: site.brand, aeo: answers, social, schema: structured, content };

  const merged = {
    ...latest,
    aeo: answers,
    aeoDate: date,
    social,
    schema: structured,
    content,
    briefsDate: date
  };
  merged.alerts = [...(latest.alerts || []), ...alert.evaluate(merged, site)];
  await alert.send(alert.evaluate(report, site), site);

  if (!answers.error) {
    await appendHistory('aeo', {
      date,
      mentionRate: answers.mentionRate,
      ownDomainCitationRate: answers.ownDomainCitationRate,
      avgBrandRank: answers.avgBrandRank,
      responsesCollected: answers.responsesCollected
    });
  }

  // Drafts land as Markdown files so they can be reviewed and edited like any other copy.
  for (const b of content.briefs || []) {
    if (b.draft) {
      const flag = b.status === 'blocked-asci' ? 'BLOCKED-ASCI-' : '';
      await writeText(`data/drafts/${date}/${flag}${b.id}.md`, b.draft);
    }
  }
  if (structured.llmsTxt) await writeText('data/generated/llms.txt', structured.llmsTxt);

  await writeJson(`data/weekly/${date}.json`, report);
  await writeJson('data/latest.json', merged);

  console.log(`Done. ${content.briefsGenerated || 0} brief(s), ${content.blockedByAsci || 0} blocked by ASCI check.`);
}

main().catch((err) => {
  console.error('Weekly run failed:', err);
  process.exit(1);
});
