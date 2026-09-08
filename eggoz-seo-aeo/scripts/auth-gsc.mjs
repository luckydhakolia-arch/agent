import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { listProperties } from './lib/gsc-oauth.mjs';

/**
 * One-time local helper. Authorises the engine to read Search Console as YOU,
 * and prints the refresh token to paste into GitHub secrets.
 *
 * This exists so the engine never needs a service account, and therefore never
 * needs a verified property owner to grant one. It runs on your machine only —
 * the refresh token is printed here and never transmitted anywhere else.
 *
 *   npm run auth:gsc
 */

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const PORT = 8724;
const REDIRECT = `http://localhost:${PORT}/callback`;

const ask = async (rl, q) => (await rl.question(q)).trim();

/** Waits for Google to redirect back with ?code=... */
function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px -apple-system,sans-serif;padding:48px;max-width:32em">
        <h2>${code ? 'Authorised' : 'Authorisation failed'}</h2>
        <p>${code ? 'You can close this tab and return to the terminal.' : String(error || 'No code returned.')}</p></body>`);
      server.close();
      code ? resolve(code) : reject(new Error(error || 'no code returned'));
    });
    server.on('error', (e) =>
      reject(new Error(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy — close whatever is using it and retry.` : e.message))
    );
    server.listen(PORT);
  });
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(`
Search Console authorisation — no service account, no property owner needed.

First, create an OAuth client. This can live in YOUR OWN Google Cloud project;
you do not need any access to the Eggoz project.

  1. console.cloud.google.com  ->  create a project (any name, it is free)
  2. APIs & Services -> Library -> enable "Google Search Console API"
  3. APIs & Services -> OAuth consent screen -> External -> fill the required
     fields -> add yourself under "Test users"
  4. APIs & Services -> Credentials -> Create credentials -> OAuth client ID
     -> Application type: Web application
     -> Authorised redirect URI: ${REDIRECT}
  5. Copy the client ID and client secret below.
`);

  const clientId = process.env.GSC_OAUTH_CLIENT_ID || (await ask(rl, 'Client ID: '));
  const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET || (await ask(rl, 'Client secret: '));
  if (!clientId || !clientSecret) { console.error('Both values are required.'); process.exit(1); }

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',   // ask for a refresh token
    prompt: 'consent'         // force one even if previously granted
  });

  console.log('\nOpen this URL, and sign in with the Google account that can see the property:\n');
  console.log(authUrl + '\n');
  console.log(`Waiting for the redirect on ${REDIRECT} ...`);

  const code = await waitForCode();
  rl.close();

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT, grant_type: 'authorization_code'
    }).toString()
  });
  const tok = await res.json();
  if (!tok.refresh_token) {
    console.error('\nNo refresh token returned:', JSON.stringify(tok, null, 2));
    console.error('Revoke the app at myaccount.google.com/permissions and run this again.');
    process.exit(1);
  }

  // Prove the grant works before telling anyone it does.
  let properties = [];
  try {
    properties = await listProperties(tok.access_token);
  } catch (err) {
    console.error('\nToken obtained but the properties call failed:', err.message);
  }

  console.log('\n--------------------------------------------------------------');
  console.log('Authorised. Properties this account can read:\n');
  properties.length
    ? properties.forEach((p) => console.log(`   ${p.url}   (${p.permission})`))
    : console.log('   none — confirm you can see the property in Search Console.');
  console.log('\nAdd these three repository secrets in GitHub');
  console.log('(Settings -> Secrets and variables -> Actions):\n');
  console.log(`   GSC_OAUTH_CLIENT_ID       ${clientId}`);
  console.log(`   GSC_OAUTH_CLIENT_SECRET   ${clientSecret}`);
  console.log(`   GSC_OAUTH_REFRESH_TOKEN   ${tok.refresh_token}`);
  console.log('\nTreat the refresh token like a password. It is printed only here.');
  console.log('--------------------------------------------------------------\n');
}

main().catch((err) => { console.error('\nAuthorisation failed:', err.message); process.exit(1); });
