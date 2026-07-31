import { fetchJson, sleep } from './store.mjs';

const UA = 'EggozSeoAeoEngine/1.0 (brand mention monitoring)';

/**
 * Answer engines cite Reddit heavily, so an unanswered Reddit thread about
 * your category is a direct AEO liability. Public JSON endpoints, no auth.
 */
export async function collect(site) {
  const terms = [site.brand, ...site.competitors.slice(0, 4), 'best egg brand india'];
  const threads = [];
  for (const term of terms) {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(term)}&sort=new&limit=25&t=month`;
      const data = await fetchJson(url, { headers: { 'user-agent': UA } }, 1);
      (data.data?.children || []).forEach((c) => {
        const p = c.data;
        threads.push({
          term,
          title: p.title,
          subreddit: p.subreddit_name_prefixed,
          url: `https://www.reddit.com${p.permalink}`,
          score: p.score,
          comments: p.num_comments,
          created: new Date(p.created_utc * 1000).toISOString().slice(0, 10),
          mentionsBrand: new RegExp(site.brandAliases.join('|'), 'i').test(`${p.title} ${p.selftext || ''}`)
        });
      });
    } catch { /* Reddit rate-limits aggressively; a miss is not fatal */ }
    await sleep(2500);
  }

  const unique = [...new Map(threads.map((t) => [t.url, t])).values()];
  return {
    threadsFound: unique.length,
    brandMentions: unique.filter((t) => t.mentionsBrand).length,
    // Live threads where the category is being discussed and we are absent.
    engagementOpportunities: unique
      .filter((t) => !t.mentionsBrand && t.comments >= 3)
      .sort((a, b) => b.comments - a.comments)
      .slice(0, 20),
    threads: unique.sort((a, b) => b.created.localeCompare(a.created)).slice(0, 60)
  };
}
