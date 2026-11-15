import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createOwnerAuth, hostingSettings } from './hosting-auth.mjs';

const pages = new Set(['index.html', 'supplier-comparison.html', 'shipping-lab.html', 'purchasing.html', 'business.html', 'shipments.html']);
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp'};
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const safeNext = value => typeof value === 'string' && (value === '/' || (value.startsWith('/') && pages.has(value.slice(1)))) ? value : '/business.html';

function send(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(data));
}
function failure(status, message) { return Object.assign(new Error(message), {status}); }
export async function readBody(req, limit = 1024 * 1024) {
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw failure(413, 'The request is too large.'); }
  return new Promise((resolve, reject) => {
    let size = 0, failed = false; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > limit) { if (!failed) reject(failure(413, 'The request is too large.')); failed = true; chunks.length = 0; } else if (!failed) chunks.push(chunk); });
    req.once('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.once('error', () => reject(failure(400, 'The request could not be read.')));
  });
}
function loginPage(res, next, message = '', status = 200) {
  res.writeHead(status, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LogisticsNerd owner login</title><style>body{margin:0;background:#f7f7f2;color:#243d33;font:16px/1.6 system-ui}main{max-width:420px;margin:10vh auto;padding:32px;background:#fffefa;border:1px solid #e5e8df;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:10px 0;font:inherit;border:1px solid #cdd6c7;border-radius:8px}button{background:#153f36;color:white}small{display:block;color:#667368}.error{color:#934532}</style><main><h1>LogisticsNerd</h1><p>Sign in to the private owner workspace.</p><p class="error" role="alert">${escape(message)}</p><form method="post" action="/auth/login"><input type="hidden" name="next" value="${escape(next)}"><label for="password">Owner password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button type="submit">Sign in</button></form><small>Use the owner password configured for this workspace.</small></main></html>`);
}

/** No Vite development server and no public forwarding of the owner service token. */
export function createProductionServer({env = process.env, staticDir = path.resolve('dist'), clientScript = path.resolve('server/hosting-client.js'), middlewares = [], apiTarget = 'http://127.0.0.1:8001', readyProbe, now} = {}) {
  const settings = hostingSettings(env), auth = createOwnerAuth(settings, {now});
  const target = new URL(apiTarget), external = new Map();
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password || target.pathname !== '/') throw new Error('The purchasing API must remain on private loopback.');
  const probe = readyProbe || (async () => {
    const response = await fetch(new URL('/internal/ready', target), {headers: {Authorization: `Bearer ${settings.apiToken}`}, signal: AbortSignal.timeout(4000)});
    return response.ok && (await response.json()).ready === true;
  });
  async function dispatch(index, req, res) {
    if (index >= middlewares.length) return send(res, 404, {error: {message: 'This API route does not exist.'}});
    return middlewares[index](req, res, () => dispatch(index + 1, req, res));
  }
  async function proxy(req, res, url) {
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw failure(415, 'Send application/json.');
      body = await readBody(req);
    }
    const headers = {Authorization: `Bearer ${settings.apiToken}`, Accept: 'application/json'};
    if (body) headers['Content-Type'] = 'application/json';
    let upstream;
    try { upstream = await fetch(new URL(url.pathname + url.search, target), {method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(40000)}); }
    catch { throw failure(503, 'The private purchasing service is unavailable.'); }
    res.writeHead(upstream.status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(Buffer.from(await upstream.arrayBuffer()));
  }
  async function asset(req, res, pathname) {
    let filename;
    try { filename = decodeURIComponent(pathname).replace(/^\//, '') || 'index.html'; } catch { throw failure(400, 'Invalid path.'); }
    if (filename.includes('\\') || filename.split('/').some(part => part.startsWith('.')) || (!pages.has(filename) && !filename.startsWith('assets/') && filename !== 'favicon.svg')) throw failure(404, 'Page not found.');
    const root = await realpath(staticDir), destination = await realpath(path.join(root, filename)).catch(() => null);
    if (!destination || !destination.startsWith(root + path.sep) || !(await stat(destination)).isFile()) throw failure(404, 'Page not found.');
    const extension = path.extname(destination);
    if (!mime[extension]) throw failure(404, 'Page not found.');
    let content = await readFile(destination);
    if (extension === '.html') content = Buffer.from(content.toString().replace('<head>', '<head><script src="/hosting-session.js"></script>'));
    res.writeHead(200, {'Content-Type': mime[extension], 'Content-Length': content.length, 'Cache-Control': extension === '.html' ? 'no-store' : 'private, max-age=3600'});
    res.end(req.method === 'HEAD' ? undefined : content);
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(req.url || '/', settings.origin);
      if (['/healthz', '/readyz'].includes(url.pathname)) {
        if (req.method !== 'GET') return send(res, 405, {error: {message: 'Use GET.'}});
        if (url.pathname === '/healthz') return send(res, 200, {alive: true});
        let ready = false; try { ready = await probe(); } catch { /* Never echo connection details. */ }
        return send(res, ready ? 200 : 503, {ready});
      }
      let host;
      try { host = new URL(settings.origin.split('//')[0] + '//' + req.headers.host).host; } catch { /* Rejected below. */ }
      if (host !== new URL(settings.origin).host || url.origin !== settings.origin) throw failure(403, 'Use the configured application address.');
      if ((req.headers.origin && req.headers.origin !== settings.origin) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw failure(403, 'Use the application page.');
      let session = auth.lookup(req);
      if (settings.publicDemo && url.pathname === '/auth/login') {
        res.writeHead(303, {Location: '/business.html', 'Cache-Control': 'no-store'}); return res.end();
      }
      if (!session && settings.publicDemo && ['GET', 'HEAD'].includes(req.method)) {
        const guest = auth.guest(); session = guest.session;
        res.setHeader('Set-Cookie', guest.cookie);
      }
      if (url.pathname === '/auth/login') {
        if (req.method === 'GET') {
          if (session) { res.writeHead(303, {Location: safeNext(url.searchParams.get('next')), 'Cache-Control': 'no-store'}); return res.end(); }
          return loginPage(res, safeNext(url.searchParams.get('next')));
        }
        if (req.method !== 'POST') throw failure(405, 'Use the login form.');
        if (req.headers.origin !== settings.origin || !/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw failure(403, 'Use the application login form.');
        const data = new URLSearchParams((await readBody(req, 4096)).toString()), next = safeNext(data.get('next'));
        const result = auth.login(data.get('password'), req.socket.remoteAddress);
        if (result.status !== 200) return loginPage(res, next, result.status === 429 ? 'Too many attempts. Try again in 15 minutes.' : 'The owner password was not accepted.', result.status);
        if (session) auth.logout(session);
        res.writeHead(303, {'Set-Cookie': result.cookie, Location: next, 'Cache-Control': 'no-store'}); return res.end();
      }
      if (!session) {
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return send(res, 401, {error: {message: 'Sign in to the owner workspace.'}});
        res.writeHead(303, {Location: '/auth/login?next=' + encodeURIComponent(safeNext(url.pathname)), 'Cache-Control': 'no-store'}); return res.end();
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !auth.csrf(req, session)) throw failure(403, 'The owner session or CSRF token is invalid. Reload the application.');
      if (url.pathname === '/auth/session' && req.method === 'GET') return send(res, 200, {authenticated: !settings.publicDemo, public_demo: settings.publicDemo, csrf_token: session.csrf, expires_at: new Date(session.expires).toISOString(), features: {ai: settings.enableAI, carriers: settings.enableCarriers, demo: settings.enableDemo}});
      if (url.pathname === '/auth/logout' && req.method === 'POST') { res.setHeader('Set-Cookie', auth.logout(session)); return send(res, 200, {authenticated: false}); }
      if (/^\/api\/(?:purchasing|business|fulfillment)(?:\/|$)/.test(url.pathname)) return await proxy(req, res, url);
      if (url.pathname.startsWith('/api/')) {
        const paid = (url.pathname === '/api/procurement/estimates' && req.method === 'POST') || (url.pathname === '/api/shipping/compare' && req.method === 'POST');
        if ((url.pathname === '/api/procurement/estimates' && !settings.enableAI) || (url.pathname === '/api/shipping/compare' && !settings.enableCarriers) || (url.pathname === '/api/demo/workflow' && !settings.enableDemo)) throw failure(403, 'This optional feature is disabled for this deployment.');
        if (paid || (url.pathname === '/api/demo/workflow' && req.method === 'POST')) {
          const at = Date.now();
          for (const [id, value] of external) if (value.until <= at) external.delete(id);
          const rate = external.get(session.id) || {count: 0, until: at + 60000};
          if (rate.count >= 10) throw failure(429, 'Too many optional-provider or demo requests. Wait a minute.');
          rate.count++; external.set(session.id, rate);
        }
        return await dispatch(0, req, res);
      }
      if (url.pathname === '/hosting-session.js' && req.method === 'GET') {
        const content = await readFile(clientScript); res.writeHead(200, {'Content-Type': mime['.js'], 'Cache-Control': 'no-store'}); return res.end(content);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw failure(405, 'Use GET.');
      await asset(req, res, url.pathname);
    } catch (error) { send(res, error.status || 500, {error: {message: error.status ? error.message : 'The hosted application could not complete this request.'}}); }
  });
  server.requestTimeout = 70000; server.headersTimeout = 15000;
  server.on('close', () => { for (const middleware of middlewares) middleware.close?.(); });
  return {server, settings};
}
