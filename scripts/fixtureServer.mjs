/**
 * Local fixture server - Artupski ReSite
 *
 * A tiny, dependency-free Node HTTP server that serves the controlled fixture
 * pages on `http://127.0.0.1:9099` (TESTING.md section 3.1). It exists so the
 * opt-in browser smoke test can launch Chromium and navigate without touching
 * any external website.
 *
 * Usage:
 *   node scripts/fixtureServer.mjs            # serve on 127.0.0.1:9099
 *   node scripts/fixtureServer.mjs --port 9099
 *
 * Programmatic use (from the opt-in test):
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

/** Routes served by the fixture server. Keep deterministic and tiny. */
const ROUTES = new Map([
  ['/simple-page', join(FIXTURES_DIR, 'simple-page', 'index.html')],
  ['/', join(FIXTURES_DIR, 'simple-page', 'index.html')]
]);

function resolveFixturePath(pathname) {
  if (ROUTES.has(pathname)) {
    return ROUTES.get(pathname);
  }
  // Containment check: only files under the fixtures directory may be served.
  const candidate = normalize(join(FIXTURES_DIR, pathname));
  if (!candidate.startsWith(FIXTURES_DIR)) {
    return null;
  }
  return candidate;
}

async function handleRequest(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? DEFAULT_FIXTURE_HOST}`);
  const filePath = resolveFixturePath(url.pathname);

  if (!filePath) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
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
  const port = portFlagIndex !== -1 ? Number(process.argv[portFlagIndex + 1]) : DEFAULT_FIXTURE_PORT;
  const server = await startFixtureServer({ port });
  // eslint-disable-next-line no-console -- standalone dev script, not app code.
  console.log(`Fixture server listening on ${server.url}`);
}
