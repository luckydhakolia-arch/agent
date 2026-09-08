import { JWT } from 'google-auth-library';
import { fetchJson } from './store.mjs';
import { analyse, dateRange } from './gsc-analyse.mjs';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function credentials() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT_JSON is not set');
  return JSON.parse(raw);
}

async function token() {
  const creds = credentials();
  const client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [SCOPE]
  });
  const { token } = await client.getAccessToken();
  return token;
}

async function query(property, accessToken, payload) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload)
  });
  return data.rows || [];
}

/**
 * Pulls a 28-day window and the previous 28-day window so every metric
 * arrives with its own delta. Absolute numbers alone are not actionable.
 *
 * Shape and analysis are shared with the OAuth collector via gsc-analyse.mjs,
 * so both auth paths return identical reports.
 */
export async function collect(site, keywords) {
  const accessToken = await token();
  const property = site.gscProperty;
  const current = dateRange(0, 28);
  const previous = dateRange(28, 28);

  const base = { rowLimit: 5000, dataState: 'final' };
  const [curQueries, prevQueries, curPages, curCountries] = await Promise.all([
    query(property, accessToken, { ...base, ...current, dimensions: ['query'] }),
    query(property, accessToken, { ...base, ...previous, dimensions: ['query'] }),
    query(property, accessToken, { ...base, ...current, dimensions: ['page'] }),
    query(property, accessToken, { ...base, ...current, dimensions: ['country'], rowLimit: 20 })
  ]);

  return analyse({
    curQueries, prevQueries, curPages, curCountries, keywords, current, previous,
    property, auth: 'service-account'
  });
}
