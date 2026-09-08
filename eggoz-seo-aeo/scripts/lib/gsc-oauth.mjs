import { fetchJson } from './store.mjs';
import { analyse, dateRange } from './gsc-analyse.mjs';

/**
 * Search Console via OAuth as *you*, instead of via a service account.
 *
 * The service-account path needs a verified property owner to add the robot as
 * a user — which you cannot do if you are only a Full or Restricted user. This
 * path removes that dependency entirely: you authorise once with the Google
 * account that already has access, and the engine reuses the refresh token.
 * Full and Restricted users can both read Performance data, so this works
 * without anyone granting you anything.
 *
 * Setup is one local command: `npm run auth:gsc`.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';

function credentials() {
  const clientId = process.env.GSC_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GSC_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GSC OAuth not configured (need GSC_OAUTH_CLIENT_ID, GSC_OAUTH_CLIENT_SECRET, GSC_OAUTH_REFRESH_TOKEN). Run: npm run auth:gsc');
  }
  return { clientId, clientSecret, refreshToken };
}

export function isConfigured() {
  return Boolean(
    process.env.GSC_OAUTH_CLIENT_ID &&
    process.env.GSC_OAUTH_CLIENT_SECRET &&
    process.env.GSC_OAUTH_REFRESH_TOKEN
  );
}

/** Refresh tokens are long-lived; access tokens last an hour, so mint one per run. */
async function accessToken() {
  const { clientId, clientSecret, refreshToken } = credentials();
  const data = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString()
  });
  if (!data.access_token) throw new Error('Token refresh returned no access_token — the refresh token may have been revoked. Re-run: npm run auth:gsc');
  return data.access_token;
}

/** Everything this Google account can actually read. */
export async function listProperties(token) {
  const data = await fetchJson(SITES_URL, { headers: { authorization: `Bearer ${token}` } });
  return (data.siteEntry || []).map((s) => ({ url: s.siteUrl, permission: s.permissionLevel }));
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/**
 * Picks the property to query. A configured gscProperty wins if the account can
 * actually reach it; otherwise the best match for the site domain is chosen, so
 * a .com/.in mix-up resolves itself instead of returning an empty report.
 */
export function pickProperty(properties, site) {
  if (!properties.length) return null;
  const configured = site.gscProperty;
  const exact = properties.find((p) => p.url === configured);
  if (exact) return exact;

  const wanted = host(site.domain);
  const bare = wanted.replace(/\.(in|com)$/, '');
  const score = (p) => {
    const u = p.url.toLowerCase();
    const h = u.startsWith('sc-domain:') ? u.slice('sc-domain:'.length) : host(u);
    if (h === wanted) return 100;                                   // exact domain
    if (h.replace(/\.(in|com)$/, '') === bare) return 80;           // same brand, other TLD
    if (h.includes(bare)) return 60;                                // brand appears in host
    return 0;
  };
  // Domain properties cover every subdomain and protocol, so prefer them — but
  // only as a tie-break among properties that already match the brand. Adding
  // the bonus before filtering would let an unrelated domain property win.
  const ranked = properties
    .map((p) => ({ p, base: score(p) }))
    .filter((x) => x.base > 0)
    .map((x) => ({ p: x.p, s: x.base + (x.p.url.startsWith('sc-domain:') ? 5 : 0) }))
    .sort((a, b) => b.s - a.s);
  return ranked.length ? ranked[0].p : null;
}

async function query(property, token, payload) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  return data.rows || [];
}

export async function collect(site, keywords) {
  const token = await accessToken();

  const properties = await listProperties(token);
  if (!properties.length) {
    throw new Error('This Google account has no Search Console properties. Sign in to search.google.com/search-console and confirm you can see the property, then re-run: npm run auth:gsc');
  }
  const chosen = pickProperty(properties, site);
  if (!chosen) {
    throw new Error(`No Search Console property matches ${site.domain}. Available: ${properties.map((p) => p.url).join(', ')}`);
  }

  const current = dateRange(0, 28);
  const previous = dateRange(28, 28);
  const base = { rowLimit: 5000, dataState: 'final' };

  const [curQueries, prevQueries, curPages, curCountries] = await Promise.all([
    query(chosen.url, token, { ...base, ...current, dimensions: ['query'] }),
    query(chosen.url, token, { ...base, ...previous, dimensions: ['query'] }),
    query(chosen.url, token, { ...base, ...current, dimensions: ['page'] }),
    query(chosen.url, token, { ...base, ...current, dimensions: ['country'], rowLimit: 20 })
  ]);

  return {
    ...analyse({
      curQueries, prevQueries, curPages, curCountries, keywords, current, previous,
      property: chosen.url,
      auth: `oauth-user (${chosen.permission})`
    }),
    availableProperties: properties
  };
}
