/**
 * Local fixture server - Artupski ReSite
 *
 * A tiny, dependency-free Node HTTP server that serves controlled fixture pages
 * on `http://127.0.0.1:9099` (TESTING.md section 3.1). It exists so the browser
 * smoke tests and the Phase 4 crawler integration test can launch Chromium and
 * crawl without touching any external website.
 *
 * Usage:
 *   node scripts/fixtureServer.mjs            # serve on 127.0.0.1:9099
 *   node scripts/fixtureServer.mjs --port 9099
 *
 * Programmatic use (from a test):
 *   import { startFixtureServer } from '../../../../scripts/fixtureServer.mjs';
 *   const server = await startFixtureServer();
 *   ...
 *   await server.stop();
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, 'fixtures');

export const DEFAULT_FIXTURE_HOST = '127.0.0.1';
export const DEFAULT_FIXTURE_PORT = 9099;

const HTML = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };

/** Static file routes. Keep deterministic and tiny. */
const FILE_ROUTES = new Map([
  ['/', join(FIXTURES_DIR, 'simple-page', 'index.html')],
  ['/simple-page', join(FIXTURES_DIR, 'simple-page', 'index.html')],
  ['/crawler', join(FIXTURES_DIR, 'crawler', 'index.html')],
  ['/crawler/', join(FIXTURES_DIR, 'crawler', 'index.html')],
  ['/crawler/about', join(FIXTURES_DIR, 'crawler', 'about.html')],
  ['/crawler/assets/logo.svg', join(FIXTURES_DIR, 'crawler', 'assets', 'logo.svg')],
  // Auth fixtures for the interactive capture flow. No real credentials.
  ['/auth/login', join(FIXTURES_DIR, 'auth', 'login.html')],
  ['/auth/public', join(FIXTURES_DIR, 'auth', 'public.html')],
  ['/auth/protected', join(FIXTURES_DIR, 'auth', 'protected.html')],
  // Responsive fixture with deliberate media-query breakpoints (Phase 7).
  ['/responsive', join(FIXTURES_DIR, 'responsive', 'index.html')],
  ['/responsive/', join(FIXTURES_DIR, 'responsive', 'index.html')],
  // Clone fixture (Phase 8): a page with local assets and a tracking script.
  ['/clone', join(FIXTURES_DIR, 'clone', 'index.html')],
  ['/clone/', join(FIXTURES_DIR, 'clone', 'index.html')],
  ['/clone/about', join(FIXTURES_DIR, 'clone', 'about.html')],
  ['/clone/assets/style.css', join(FIXTURES_DIR, 'clone', 'assets', 'style.css')],
  ['/clone/assets/logo.svg', join(FIXTURES_DIR, 'clone', 'assets', 'logo.svg')],
  ['/clone/assets/app.js', join(FIXTURES_DIR, 'clone', 'assets', 'app.js')]
]);

/**
 * Name of the deterministic session cookie the auth fixture issues on login.
 * It is a fixed, non-sensitive marker, never a real credential.
 */
export const FIXTURE_SESSION_COOKIE = 'fixture_session';
const FIXTURE_SESSION_VALUE = 'authenticated';

/** Behavioural routes exercised by the Phase 4 crawler tests. */
const REDIRECTS = new Map([
  ['/crawler/redirect', '/crawler/about'],
  ['/crawler/redirect-loop', '/crawler/redirect-loop'],
  ['/crawler/redirect-metadata', 'http://169.254.169.254/latest/meta-data/'],
  ['/crawler/redirect-external', 'https://external.example.com/partner']
]);

function resolveFixturePath(pathname) {
  if (FILE_ROUTES.has(pathname)) {
    return FILE_ROUTES.get(pathname);
  }
  // Containment check: only files under the fixtures directory may be served.
  const candidate = normalize(join(FIXTURES_DIR, pathname));
  if (!candidate.startsWith(FIXTURES_DIR)) {
    return null;
  }
  return candidate;
}

/** True when the request carries the fixture session cookie with its value. */
function hasFixtureSession(cookieHeader) {
  if (!cookieHeader) {
    return false;
  }
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .some((part) => {
      const [name, value] = part.split('=');
      return name === FIXTURE_SESSION_COOKIE && value === FIXTURE_SESSION_VALUE;
    });
}

async function serveFile(response, filePath, contentType = HTML) {
  try {
    const body = await readFile(filePath);
    response.writeHead(200, contentType);
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? DEFAULT_FIXTURE_HOST}`);
  const pathname = url.pathname;

  if (REDIRECTS.has(pathname)) {
    response.writeHead(302, { location: REDIRECTS.get(pathname), 'cache-control': 'no-store' });
    response.end();
    return;
  }

  // Auth fixture: a POST to the login route issues the deterministic session
  // cookie and redirects to the protected page. No credential is ever checked
  // or stored - this fixture simulates a login, it does not authenticate anyone.
  if (pathname === '/auth/login' && request.method === 'POST') {
    response.writeHead(302, {
      location: '/auth/protected',
      'set-cookie': `${FIXTURE_SESSION_COOKIE}=${FIXTURE_SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax`,
      'cache-control': 'no-store'
    });
    response.end();
    return;
  }

  // Deterministic "completed login" link for the capture E2E: it issues the same
  // session cookie as the POST handler and redirects onward. It performs no
  // credential check and accepts no user input, so the test never automates
  // credential entry.
  if (pathname === '/auth/login/complete') {
    response.writeHead(302, {
      location: '/auth/protected',
      'set-cookie': `${FIXTURE_SESSION_COOKIE}=${FIXTURE_SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax`,
      'cache-control': 'no-store'
    });
    response.end();
    return;
  }

  // Protected page: require the session cookie; otherwise 401 with a sign-in
  // link, which is the auth wall the classifier is expected to detect.
  if (pathname === '/auth/protected' && !hasFixtureSession(request.headers.cookie)) {
    response.writeHead(401, { ...HTML, 'www-authenticate': 'Cookie realm="fixture"' });
    response.end(
      '<!doctype html><title>Sign in required</title><p><a href="/auth/login">Sign in</a></p>'
    );
    return;
  }

  if (pathname === '/crawler/binary') {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store'
    });
    response.end(Buffer.from([0x00, 0x01, 0x02, 0x03]));
    return;
  }

  if (pathname === '/crawler/json') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === '/crawler/slow') {
    // Deliberately never finishes within a short navigation timeout.
    setTimeout(() => {
      response.writeHead(200, HTML);
      response.end('<!doctype html><title>Slow</title><h1>Slow</h1>');
    }, 5000);
    return;
  }

  if (pathname === '/crawler/missing') {
    response.writeHead(404, HTML);
    response.end('<!doctype html><title>Missing</title><h1>404</h1>');
    return;
  }

  const filePath = resolveFixturePath(pathname);
  if (!filePath) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const contentType = filePath.endsWith('.svg')
    ? { 'content-type': 'image/svg+xml' }
    : filePath.endsWith('.css')
      ? { 'content-type': 'text/css; charset=utf-8' }
      : filePath.endsWith('.js')
        ? { 'content-type': 'text/javascript; charset=utf-8' }
        : HTML;
  await serveFile(response, filePath, contentType);
}

/**
 * Start the fixture server. Resolves once it is listening.
 * @param {{ host?: string, port?: number }} [options]
 */
export function startFixtureServer(options = {}) {
  const host = options.host ?? DEFAULT_FIXTURE_HOST;
  const port = options.port ?? DEFAULT_FIXTURE_PORT;
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        host,
        port,
        url: `http://${host}:${port}`,
        stop: () =>
          new Promise((stopResolve) => {
            server.close(() => stopResolve());
          })
      });
    });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const portFlagIndex = process.argv.indexOf('--port');
  const port =
    portFlagIndex !== -1 ? Number(process.argv[portFlagIndex + 1]) : DEFAULT_FIXTURE_PORT;
  const server = await startFixtureServer({ port });
  // eslint-disable-next-line no-console -- standalone dev script, not app code.
  console.log(`Fixture server listening on ${server.url}`);
}
