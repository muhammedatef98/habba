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
import { createServer } from 'node:http';

const UPSTREAM = process.env.HABBA_UPSTREAM ?? 'http://127.0.0.1:54321';
const PORT = Number(process.env.HABBA_GATEWAY_PORT ?? 54331);
const PREFIX = '/rest/v1';

const deny = (res, status, message) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ message }));
};

createServer(async (req, res) => {
  try {
    // Supabase answers 401 to a request with no apikey, whatever the bearer
    // token says. The suite must send both.
    if (req.headers.apikey === undefined) {
      deny(res, 401, 'No API key found in request');
      return;
    }
    if (!req.url?.startsWith(`${PREFIX}/`)) {
      deny(res, 404, 'Invalid path specified in request URL');
      return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);

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
