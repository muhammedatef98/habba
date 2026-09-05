/**
 * A stand-in for Supabase's edge gateway, in front of the local harness.
 *
 * Why this exists: the local harness is bare PostgREST, which serves the tables
 * at its own root and accepts a bearer token with no apikey header. A hosted
 * project has a gateway in front that does neither — it routes `/rest/v1/*` to
 * PostgREST and rejects anything without an apikey. Those two differences are
 * not RLS, so `tests/rls.spec.ts` proved nothing about them, and the first real
 * hosted run died on both: every write went to `/rest/v1/rest/v1/...` ("Invalid
 * path specified in request URL"), behind a 401 that the suite reported only as
 * "harness unreachable".
 *
 * Running the same 17 assertions through this gateway with HABBA_HOSTED=1
 * exercises the hosted request shape on every CI run. It proves the URL and
 * header plumbing, and nothing else — the gateway is not Supabase, does not
 * verify the apikey, and has no opinion about RLS.
 */
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const UPSTREAM = process.env.HABBA_UPSTREAM ?? 'http://127.0.0.1:54321';
const PORT = Number(process.env.HABBA_GATEWAY_PORT ?? 54331);
const SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';
const FIXTURE_PASSWORD = process.env.HABBA_FIXTURE_PASSWORD ?? '';
const PREFIX = '/rest/v1';

const deny = (res, status, message) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ message }));
};

const b64url = (value) => Buffer.from(value).toString('base64url');

/**
 * Stands in for GoTrue's password grant.
 *
 * Since the suite stopped minting its own tokens, the sign-in is part of the
 * hosted request shape and belongs here — otherwise this check would exercise
 * everything about a hosted run except how it gets a token. The token is signed
 * with the harness's shared secret because that is what the local PostgREST
 * verifies; what is being checked is the exchange, not the algorithm.
 */
function passwordGrant(body) {
  const email = typeof body.email === 'string' ? body.email : '';
  const match = /^rls-([0-9a-f-]{36})@habba\.test$/.exec(email);

  if (match === null) return { status: 400, payload: { error: 'invalid_grant' } };
  if (FIXTURE_PASSWORD === '' || body.password !== FIXTURE_PASSWORD) {
    return { status: 400, payload: { error: 'invalid_grant', error_description: 'Bad password' } };
  }

  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ sub: match[1], role: 'authenticated', iat: now, exp: now + 3600 }),
  );
  const signature = createHmac('sha256', SECRET).update(`${head}.${claims}`).digest('base64url');

  return { status: 200, payload: { access_token: `${head}.${claims}.${signature}` } };
}

createServer(async (req, res) => {
  try {
    // Supabase answers 401 to a request with no apikey, whatever the bearer
    // token says. The suite must send both.
    if (req.headers.apikey === undefined) {
      deny(res, 401, 'No API key found in request');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);

    if (req.url?.startsWith('/auth/v1/token')) {
      let parsed = {};
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      } catch {
        // An unparseable body is an invalid grant, not a crash.
      }
      const { status, payload } = passwordGrant(parsed);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (!req.url?.startsWith(`${PREFIX}/`)) {
      deny(res, 404, 'Invalid path specified in request URL');
      return;
    }

    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    delete headers.connection;

    const upstream = await fetch(UPSTREAM + req.url.slice(PREFIX.length), {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
    });

    const body = await upstream.text();
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      ...(upstream.headers.get('content-range')
        ? { 'content-range': upstream.headers.get('content-range') }
        : {}),
    });
    res.end(body);
  } catch (error) {
    deny(res, 502, error instanceof Error ? error.message : String(error));
  }
}).listen(PORT, () => {
  process.stdout.write(`hosted-shape gateway on http://127.0.0.1:${PORT}\n`);
});
