/**
 * Alerts exist so you do not have to open the dashboard to know something broke.
 * Set ALERT_WEBHOOK to a Slack or Google Chat incoming webhook URL.
 */
export function evaluate(report, site) {
  const t = site.thresholds;
  const alerts = [];
  const seo = report.seo || {};
  const prev = report.previous || {};

  if (seo.totals && prev.seoTotals) {
    const drop = prev.seoTotals.clicks
      ? ((prev.seoTotals.clicks - seo.totals.clicks) / prev.seoTotals.clicks) * 100
      : 0;
    if (drop >= t.clicksDropPercentAlert) {
      alerts.push({ level: 'high', area: 'seo', message: `Search clicks down ${drop.toFixed(0)}% versus the last run (${prev.seoTotals.clicks} to ${seo.totals.clicks}).` });
    }
  }

  (seo.decayed || []).slice(0, 3).forEach((q) => {
    alerts.push({ level: 'medium', area: 'seo', message: `"${q.query}" fell ${Math.abs(q.positionDelta)} positions to ${q.position} on ${q.impressions} impressions.` });
  });

  if (report.psi?.avgPerformance != null && report.psi.avgPerformance < t.psiPerformanceFloor) {
    alerts.push({ level: 'medium', area: 'technical', message: `Mobile performance averaging ${report.psi.avgPerformance}, below the floor of ${t.psiPerformanceFloor}.` });
  }
  if (report.psi?.avgSeo != null && report.psi.avgSeo < t.psiSeoFloor) {
    alerts.push({ level: 'medium', area: 'technical', message: `Lighthouse SEO averaging ${report.psi.avgSeo}, below the floor of ${t.psiSeoFloor}.` });
  }

  if (report.crawl?.robotsBlocksAiCrawlers) {
    alerts.push({ level: 'high', area: 'aeo', message: 'robots.txt is blocking AI crawlers. Answer engines cannot read the site.' });
  }
  if (report.crawl && report.crawl.hasLlmsTxt === false) {
    alerts.push({ level: 'low', area: 'aeo', message: 'No llms.txt on the domain. The weekly run generates one to hand to dev.' });
  }

  // Only alert on a mention rate that was actually measured. A run with no
  // engine keys returns 0% because nothing was asked, not because the brand is
  // absent — alerting on that is a false alarm that trains you to ignore alerts.
  const aeoMeasured =
    report.aeo && !report.aeo.error && !report.aeo.skipped && (report.aeo.responsesCollected || 0) > 0;
  if (aeoMeasured && report.aeo.mentionRate < t.aeoMentionRateFloor) {
    alerts.push({ level: 'high', area: 'aeo', message: `${site.brand} appears in only ${Math.round(report.aeo.mentionRate * 100)}% of answer-engine responses, below the floor of ${Math.round(t.aeoMentionRateFloor * 100)}%.` });
  }

  // Sections that could not run are worth surfacing as configuration problems,
  // distinctly from measured regressions.
  [['seo', report.seo], ['aeo', report.aeo], ['content', report.content]].forEach(([area, section]) => {
    if (section?.skipped) {
      alerts.push({ level: 'low', area, message: `Not measured this run — ${section.reason}` });
    }
  });

  // Credential-free performance probe (Google-free mode) reports its own budget.
  if (report.psi?.method === 'http-probe' && report.psi.pagesOverBudget > 0) {
    alerts.push({ level: 'medium', area: 'technical', message: `${report.psi.pagesOverBudget} priority page(s) over the performance budget — avg ${report.psi.avgTtfbMs}ms response, ${report.psi.avgTotalKb}KB.` });
  }

  return alerts;
}

export async function send(alerts, site) {
  const hook = process.env.ALERT_WEBHOOK;
  if (!hook || alerts.length === 0) return false;
  const high = alerts.filter((a) => a.level === 'high');
  const lines = alerts.map((a) => `${a.level === 'high' ? '[!]' : a.level === 'medium' ? '[~]' : '[.]'} ${a.message}`);
  const text = `*${site.brand} SEO/AEO engine* — ${alerts.length} alert${alerts.length === 1 ? '' : 's'}${high.length ? `, ${high.length} high` : ''}\n${lines.join('\n')}`;
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    });
    return true;
  } catch {
    return false;
  }
}
