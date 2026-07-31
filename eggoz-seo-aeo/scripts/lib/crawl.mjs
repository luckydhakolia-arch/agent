import * as cheerio from 'cheerio';
import { sleep } from './store.mjs';

const UA = 'EggozSeoAeoEngine/1.0 (+https://eggoz.in)';

async function getText(url, timeout = 25000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function sitemapUrls(sitemapUrl, limit, seen = new Set(), depth = 0) {
  if (depth > 2) return [];
  const xml = await getText(sitemapUrl);
  const $ = cheerio.load(xml, { xmlMode: true });
  const nested = $('sitemap > loc').map((_, el) => $(el).text().trim()).get();
  let urls = $('url > loc').map((_, el) => $(el).text().trim()).get();
  for (const child of nested) {
    if (urls.length >= limit || seen.has(child)) continue;
    seen.add(child);
    try {
      urls = urls.concat(await sitemapUrls(child, limit - urls.length, seen, depth + 1));
    } catch { /* a broken child sitemap should not kill the crawl */ }
  }
  return urls.slice(0, limit);
}

function auditPage(url, html) {
  const $ = cheerio.load(html);
  const jsonLd = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      (Array.isArray(parsed) ? parsed : [parsed]).forEach((o) => {
        const graph = o['@graph'];
        (Array.isArray(graph) ? graph : [o]).forEach((n) => n && n['@type'] && jsonLd.push(n['@type']));
      });
    } catch { jsonLd.push('INVALID_JSON_LD'); }
  });

  const title = $('title').first().text().trim();
  const desc = $('meta[name="description"]').attr('content')?.trim() || '';
  const h1 = $('h1').map((_, el) => $(el).text().trim()).get();
  const h2 = $('h2').map((_, el) => $(el).text().trim()).get();
  $('script, style, nav, footer, header').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const words = bodyText ? bodyText.split(' ').length : 0;

  // A question-shaped H2/H3 with an answer under it is what answer engines lift.
  const questionHeadings = h2.concat($('h3').map((_, el) => $(el).text().trim()).get())
    .filter((t) => /\?$/.test(t) || /^(what|why|how|when|which|can|is|are|do|does)\b/i.test(t));

  const issues = [];
  if (!title) issues.push('Missing title');
  else if (title.length > 62) issues.push(`Title too long (${title.length} chars)`);
  if (!desc) issues.push('Missing meta description');
  else if (desc.length > 158) issues.push(`Meta description too long (${desc.length} chars)`);
  if (h1.length === 0) issues.push('No H1');
  if (h1.length > 1) issues.push(`Multiple H1 tags (${h1.length})`);
  if (!$('link[rel="canonical"]').attr('href')) issues.push('Missing canonical');
  if (!$('meta[property="og:title"]').attr('content')) issues.push('Missing Open Graph tags');
  if (jsonLd.length === 0) issues.push('No structured data (JSON-LD)');
  if (jsonLd.includes('INVALID_JSON_LD')) issues.push('Malformed JSON-LD');
  if (words < 300) issues.push(`Thin content (${words} words)`);
  if (questionHeadings.length === 0) issues.push('No question-shaped headings — poor answer-engine extractability');
  const imgs = $('img');
  const noAlt = imgs.filter((_, el) => !$(el).attr('alt')).length;
  if (noAlt > 0) issues.push(`${noAlt} images missing alt text`);

  return {
    url, title, titleLength: title.length, description: desc, descriptionLength: desc.length,
    h1, h2: h2.slice(0, 15), questionHeadings: questionHeadings.slice(0, 15),
    words, schemaTypes: [...new Set(jsonLd)], imagesMissingAlt: noAlt, issues
  };
}

export async function collect(site) {
  let urls = [];
  try {
    urls = await sitemapUrls(site.sitemap, site.maxPagesPerCrawl);
  } catch {
    urls = site.priorityPages.map((p) => new URL(p, site.domain).toString());
  }
  if (urls.length === 0) urls = site.priorityPages.map((p) => new URL(p, site.domain).toString());

  const pages = [];
  for (const url of urls) {
    try {
      pages.push(auditPage(url, await getText(url)));
    } catch (err) {
      pages.push({ url, error: String(err.message).slice(0, 160), issues: ['Page could not be fetched'] });
    }
    await sleep(700);
  }

  const [robots, llms] = await Promise.all([
    getText(new URL('/robots.txt', site.domain).toString()).catch(() => null),
    getText(new URL('/llms.txt', site.domain).toString()).catch(() => null)
  ]);

  const issueCounts = {};
  pages.forEach((p) => (p.issues || []).forEach((i) => {
    const key = i.replace(/\(\d+[^)]*\)/, '').replace(/^\d+\s/, '').trim();
    issueCounts[key] = (issueCounts[key] || 0) + 1;
  }));

  const schemaCoverage = {};
  pages.forEach((p) => (p.schemaTypes || []).forEach((t) => (schemaCoverage[t] = (schemaCoverage[t] || 0) + 1)));

  return {
    pagesCrawled: pages.length,
    pagesWithIssues: pages.filter((p) => (p.issues || []).length > 0).length,
    totalIssues: pages.reduce((s, p) => s + (p.issues || []).length, 0),
    hasLlmsTxt: Boolean(llms),
    hasRobotsTxt: Boolean(robots),
    robotsBlocksAiCrawlers: robots ? /GPTBot|ClaudeBot|PerplexityBot|Google-Extended/i.test(robots) : false,
    issueCounts, schemaCoverage, pages
  };
}
