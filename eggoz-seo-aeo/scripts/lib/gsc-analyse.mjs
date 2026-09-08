/**
 * Pure transform over raw Search Console rows. Shared by both auth paths —
 * the service-account collector (gsc.mjs) and the OAuth-as-yourself collector
 * (gsc-oauth.mjs) — so the two produce byte-identical report shapes and the
 * downstream brief generator cannot tell them apart.
 */

export function bucketOf(term, buckets) {
  for (const [name, list] of Object.entries(buckets || {})) {
    if (list.some((k) => term.includes(k) || k.includes(term))) return name;
  }
  return 'other';
}

/** Search Console data lags ~3 days. Never ask for dates it cannot have. */
export function dateRange(daysBack, windowDays) {
  const end = new Date(Date.now() - (daysBack + 3) * 86400000);
  const start = new Date(end.getTime() - (windowDays - 1) * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export function analyse({ curQueries, prevQueries, curPages, curCountries, keywords, current, previous, property, auth }) {
  const prevMap = new Map(prevQueries.map((r) => [r.keys[0], r]));
  const queries = curQueries.map((r) => {
    const term = r.keys[0];
    const prev = prevMap.get(term);
    return {
      query: term,
      bucket: bucketOf(term, keywords.buckets),
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: +(r.ctr * 100).toFixed(2),
      position: +r.position.toFixed(1),
      clicksDelta: prev ? r.clicks - prev.clicks : null,
      positionDelta: prev ? +(prev.position - r.position).toFixed(1) : null,
      isNew: !prev
    };
  });

  const totals = queries.reduce(
    (acc, q) => { acc.clicks += q.clicks; acc.impressions += q.impressions; return acc; },
    { clicks: 0, impressions: 0 }
  );

  // Position 5-20 with real impressions: already visible, one push from traffic.
  const striking = queries
    .filter((q) => q.position >= 4.5 && q.position <= 20 && q.impressions >= 30)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 40);

  // High impressions, low CTR: the SERP snippet or title is failing, not the ranking.
  const weakSnippets = queries
    .filter((q) => q.impressions >= 100 && q.ctr < 1.5 && q.position <= 12)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25);

  const decayed = queries
    .filter((q) => q.positionDelta !== null && q.positionDelta <= -3 && q.impressions >= 50)
    .sort((a, b) => a.positionDelta - b.positionDelta)
    .slice(0, 25);

  return {
    property,
    auth,
    window: current,
    previousWindow: previous,
    totals: {
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr: totals.impressions ? +((totals.clicks / totals.impressions) * 100).toFixed(2) : 0,
      avgPosition: queries.length
        ? +(queries.reduce((s, q) => s + q.position, 0) / queries.length).toFixed(1)
        : 0,
      queryCount: queries.length
    },
    byBucket: Object.fromEntries(
      Object.keys(keywords.buckets).concat('other').map((b) => {
        const rows = queries.filter((q) => q.bucket === b);
        return [b, {
          clicks: rows.reduce((s, q) => s + q.clicks, 0),
          impressions: rows.reduce((s, q) => s + q.impressions, 0),
          queries: rows.length
        }];
      })
    ),
    topQueries: [...queries].sort((a, b) => b.clicks - a.clicks).slice(0, 100),
    strikingDistance: striking,
    weakSnippets,
    decayed,
    topPages: curPages
      .map((r) => ({
        page: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: +(r.ctr * 100).toFixed(2),
        position: +r.position.toFixed(1)
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 50),
    topCountries: curCountries.map((r) => ({ country: r.keys[0], clicks: r.clicks }))
  };
}
