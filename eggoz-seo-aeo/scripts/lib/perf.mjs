import * as cheerio from 'cheerio';
import { sleep } from './store.mjs';

/**
 * Credential-free performance probe. Replaces the PageSpeed Insights collector,
 * which needs a Google API key and returns HTTP 429 without one.
 *
 * This does NOT reproduce Lighthouse — it cannot measure LCP, CLS or INP, which
 * need a real browser. It measures what a plain HTTP client honestly can:
 * server response time, transferred page weight, and the render-blocking and
 * image hygiene issues that cause most slow first paints. Numbers are reported
 * as raw measurements with explicit flags, never as a fabricated 0-100 score.
 */

const UA = 'EggozSeoAeoEngine/1.0 (+https://eggoz.in)';

// Budgets are deliberately generous; they flag the obviously broken, not the merely imperfect.
const BUDGET = {
  ttfbMs: 800,
  htmlKb: 150,
  totalKb: 2048,
  blockingScripts: 5
};

async function timedFetch(url, timeout = 25000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ac.signal });
    // fetch resolves once response headers are in, so this approximates TTFB.
    const ttfb = Date.now() - started;
    const body = await res.text();
    return { ok: res.ok, status: res.status, ttfb, total: Date.now() - started, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Sum Content-Length across referenced assets. Servers that omit it are counted as unknown. */
async function assetWeight(urls, cap = 25) {
  let bytes = 0, measured = 0, unknown = 0;
  for (const u of urls.slice(0, cap)) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    try {
      const res = await fetch(u, { method: 'HEAD', headers: { 'user-agent': UA }, signal: ac.signal });
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > 0) { bytes += len; measured++; } else { unknown++; }
    } catch {
      unknown++;
    } finally {
      clearTimeout(timer);
    }
  }
  return { bytes, measured, unknown, skipped: Math.max(0, urls.length - cap) };
}

const abs = (src, base) => { try { return new URL(src, base).toString(); } catch { return null; } };

async function auditPage(url) {
  const res = await timedFetch(url);
  if (!res.ok) return { url, error: `HTTP ${res.status}` };

  const $ = cheerio.load(res.body);
  const htmlBytes = Buffer.byteLength(res.body, 'utf8');

  // A script without defer/async/module in <head> blocks the parser.
  const blocking = $('head script[src]')
    .filter((_, el) => !$(el).attr('defer') && !$(el).attr('async') && $(el).attr('type') !== 'module')
    .length;

  const scripts = $('script[src]').map((_, el) => abs($(el).attr('src'), url)).get().filter(Boolean);
  const styles = $('link[rel="stylesheet"]').map((_, el) => abs($(el).attr('href'), url)).get().filter(Boolean);
  const imgs = $('img');
  const images = imgs.map((_, el) => abs($(el).attr('src') || $(el).attr('data-src'), url)).get().filter(Boolean);

  // Images without explicit dimensions are the classic cause of layout shift.
  const imagesNoDims = imgs.filter((_, el) => !$(el).attr('width') || !$(el).attr('height')).length;
  const imagesNoLazy = imgs.filter((_, el) => $(el).attr('loading') !== 'lazy').length;

  const weight = await assetWeight([...styles, ...scripts, ...images]);
  const totalKb = Math.round((htmlBytes + weight.bytes) / 1024);

  const issues = [];
  if (res.ttfb > BUDGET.ttfbMs) issues.push(`Slow server response (${res.ttfb}ms, budget ${BUDGET.ttfbMs}ms)`);
  if (htmlBytes / 1024 > BUDGET.htmlKb) issues.push(`Heavy HTML (${Math.round(htmlBytes / 1024)}KB, budget ${BUDGET.htmlKb}KB)`);
  if (totalKb > BUDGET.totalKb) issues.push(`Heavy page (${totalKb}KB measured, budget ${BUDGET.totalKb}KB)`);
  if (blocking > BUDGET.blockingScripts) issues.push(`${blocking} render-blocking scripts in <head> (budget ${BUDGET.blockingScripts})`);
  if (imagesNoDims > 0) issues.push(`${imagesNoDims} images without width/height — layout shift risk`);

  return {
    url,
    ttfbMs: res.ttfb,
    loadMs: res.total,
    htmlKb: Math.round(htmlBytes / 1024),
    totalKb,
    weightMeasured: weight.measured,
    weightUnknown: weight.unknown + weight.skipped,
    blockingScripts: blocking,
    scripts: scripts.length,
    stylesheets: styles.length,
    images: images.length,
    imagesNoDims,
    imagesNoLazy,
    issues
  };
}

export async function collect(site) {
  const pages = [];
  for (const p of site.priorityPages) {
    const url = new URL(p, site.domain).toString();
    try {
      pages.push(await auditPage(url));
    } catch (err) {
      pages.push({ url, error: String(err.message).slice(0, 200) });
    }
    await sleep(600);
  }

  const ok = pages.filter((p) => !p.error);
  const avg = (f) => (ok.length ? Math.round(ok.reduce((s, p) => s + (p[f] || 0), 0) / ok.length) : null);

  return {
    method: 'http-probe',
    note: 'Credential-free measurement. Server timing and transferred weight are real; LCP/CLS/INP need a browser and are not measured.',
    budget: BUDGET,
    pages,
    avgTtfbMs: avg('ttfbMs'),
    avgTotalKb: avg('totalKb'),
    pagesOverBudget: ok.filter((p) => p.issues.length > 0).length,
    totalIssues: ok.reduce((s, p) => s + p.issues.length, 0)
  };
}
