import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createServer, request as httpRequest} from 'node:http';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProductionServer} from '../server/production-gateway.mjs';
import {createOwnerAuth, hostingSettings} from '../server/hosting-auth.mjs';
import {requestOriginAllowed} from '../server/request-origin.mjs';

const password = 'fictional-hosted-owner-password-42', apiToken = 'private-api-service-token-not-for-browser-42';
const env = {APP_ORIGIN: 'https://owner.example.test', HOST_OWNER_PASSWORD: password,
  HOST_SESSION_SECRET: 'fictional-cookie-signing-secret-42-abcdef', LOGISTICS_API_TOKEN: apiToken};
let root, upstream, backend, requests = [];
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
const close = server => new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'logistics-hosting-'));
  await mkdir(path.join(root, 'assets'));
  for (const name of ['index.html', 'supplier-comparison.html', 'shipping-lab.html', 'purchasing.html', 'business.html', 'shipments.html']) await writeFile(path.join(root, name), '<html><head><title>' + name + '</title></head><body>Built app</body></html>');
  await writeFile(path.join(root, 'assets', 'app.js'), 'console.log("built")');
  upstream = createServer((req, res) => {
    requests.push({path: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie});
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(req.url === '/internal/ready' ? {ready: true} : {saved: true, body: body ? JSON.parse(body) : null})); });
  });
  backend = await listen(upstream);
});
after(async () => {await close(upstream); await rm(root, {recursive: true});});

async function fixture(extra = {}) {
  const hosted = createProductionServer({env, staticDir: root, apiTarget: backend, ...extra});
  const address = await listen(hosted.server);
  async function request(route, {cookie, csrf, method = 'GET', headers = {}, body} = {}) {
    return new Promise((resolve, reject) => { const req = httpRequest(address + route, {method, headers: {Host: 'owner.example.test', ...(cookie ? {Cookie: cookie} : {}), ...(csrf ? {'X-CSRF-Token': csrf} : {}), ...headers}}, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: response.statusCode, headers: response.headers}))); }); req.on('error', reject); req.end(body === undefined ? undefined : String(body)); });
  }
  async function login() {
    const response = await request('/auth/login', {method: 'POST', headers: {Origin: env.APP_ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({password})});
    assert.equal(response.status, 303);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const session = await (await request('/auth/session', {cookie})).json();
    return {cookie, csrf: session.csrf_token};
  }
  return {request, login, stop: () => close(hosted.server)};
}

test('production configuration fails closed and exact configured HTTPS origins work', () => {
  for (const replacement of [{APP_ORIGIN: 'http://public.example'}, {APP_ORIGIN: 'https://owner.example/path'}, {HOST_OWNER_PASSWORD: 'short'}, {HOST_SESSION_SECRET: 'short'}, {LOGISTICS_API_TOKEN: 'short'}]) assert.throws(() => hostingSettings({...env, ...replacement}));
  assert.equal(requestOriginAllowed({headers: {origin: env.APP_ORIGIN, host: 'owner.example.test'}}, env), true);
  assert.equal(requestOriginAllowed({headers: {origin: 'https://evil.example', host: 'owner.example.test'}}, env), false);
  assert.equal(requestOriginAllowed({headers: {origin: 'http://localhost:5173', host: 'localhost:5173'}}, {}), true);
});

test('anonymous requests never obtain the internal owner proxy or optional providers', async () => {
  const app = await fixture();
  try {
    const before = requests.length;
    for (const route of ['/api/business/workspace', '/api/purchasing/orders', '/api/fulfillment/shipments', '/api/procurement/estimates', '/api/shipping/compare', '/api/demo/workflow']) {
      const response = await app.request(route, {method: 'POST', headers: {Origin: env.APP_ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiToken}, body: '{}'});
      assert.equal(response.status, 401); assert(!(await response.text()).includes(apiToken));
    }
    assert.equal(requests.length, before);
    assert.equal((await app.request('/business.html')).status, 303);
    const badHost = await app.request('/auth/login', {headers: {Host: 'evil.example'}});
    assert.equal(badHost.status, 403);
  } finally {await app.stop();}
});

test('owner session uses secure cookies and CSRF before all forwarded mutations', async () => {
  const app = await fixture();
  try {
    const response = await app.request('/auth/login', {method: 'POST', headers: {Origin: env.APP_ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({password, next: 'https://evil.example'})});
    assert.equal(response.headers.get('location'), '/business.html');
    assert.match(response.headers.get('set-cookie'), /__Host-logistics_owner=/);
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Secure/);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const session = await (await app.request('/auth/session', {cookie})).json();
    const body = JSON.stringify({idempotency_key: 'fictional-command'});
    for (const headers of [{Origin: env.APP_ORIGIN}, {Origin: 'https://evil.example', 'X-CSRF-Token': session.csrf_token}, {'X-CSRF-Token': session.csrf_token}]) {
      assert.equal((await app.request('/api/purchasing/orders', {cookie, method: 'POST', headers: {...headers, 'Content-Type': 'application/json'}, body})).status, 403);
    }
    const saved = await app.request('/api/purchasing/orders', {cookie, csrf: session.csrf_token, method: 'POST', headers: {Origin: env.APP_ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer attacker-controlled'}, body});
    assert.equal(saved.status, 200); assert.equal((await saved.json()).saved, true);
    assert.equal(requests.at(-1).authorization, 'Bearer ' + apiToken); assert.equal(requests.at(-1).cookie, undefined);
    assert.equal((await app.request('/auth/logout', {cookie, csrf: session.csrf_token, method: 'POST', headers: {Origin: env.APP_ORIGIN}})).status, 200);
    assert.equal((await app.request('/api/business/workspace', {cookie})).status, 401);
  } finally {await app.stop();}
});

test('all six built pages inject only the CSRF session helper and reject private files', async () => {
  const app = await fixture();
  try {
    const session = await app.login();
    for (const route of ['/', '/supplier-comparison.html', '/shipping-lab.html', '/purchasing.html', '/business.html', '/shipments.html']) {
      const response = await app.request(route, session); assert.equal(response.status, 200);
      const html = await response.text(); assert.match(html, /hosting-session\.js/); assert(!html.includes(password)); assert(!html.includes(apiToken));
    }
    for (const route of ['/.env', '/server/hosting-auth.mjs', '/assets/%2e%2e/%2eenv']) assert.equal((await app.request(route, session)).status, 404);
  } finally {await app.stop();}
});

test('provider actions are disabled by default and enabling them retains a bounded authenticated rate', async () => {
  let calls = 0;
  const middleware = (req, res) => {calls++; res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{}');};
  for (const enabled of [false, true]) {
    const app = await fixture({env: {...env, HOST_ENABLE_AI: String(enabled)}, middlewares: [middleware]});
    try {
      const session = await app.login();
      const post = () => app.request('/api/procurement/estimates', {...session, method: 'POST', headers: {Origin: env.APP_ORIGIN, 'Content-Type': 'application/json'}, body: '{}'});
      if (!enabled) {assert.equal((await post()).status, 403); assert.equal(calls, 0);}
      else {for (let i = 0; i < 10; i++) assert.equal((await post()).status, 200); assert.equal((await post()).status, 429); assert.equal(calls, 10);}
    } finally {await app.stop();}
  }
});

test('readiness really reaches the private API with its credential and reports failure safely', async () => {
  const app = await fixture();
  try {
    assert.equal((await app.request('/readyz')).status, 200);
    assert.equal(requests.at(-1).path, '/internal/ready'); assert.equal(requests.at(-1).authorization, 'Bearer ' + apiToken);
  } finally {await app.stop();}
  const unavailable = await fixture({readyProbe: () => {throw Error('database-password-must-not-leak');}});
  try {const response = await unavailable.request('/readyz'); assert.equal(response.status, 503); assert.deepEqual(await response.json(), {ready: false});} finally {await unavailable.stop();}
});

test('session expiry, tampering, and repeated wrong-password attempts fail closed', () => {
  let at = 0; const auth = createOwnerAuth(hostingSettings(env), {now: () => at});
  const result = auth.login(password, 'one'); assert.equal(result.status, 200);
  const cookie = result.cookie.split(';')[0]; assert(auth.lookup({headers: {cookie}}));
  assert.equal(auth.lookup({headers: {cookie: cookie + 'tampered'}}), null);
  at = 8 * 60 * 60 * 1000; assert.equal(auth.lookup({headers: {cookie}}), null);
  for (let i = 0; i < 5; i++) assert.equal(auth.login('wrong', 'attacker').status, 401);
  assert.equal(auth.login(password, 'attacker').status, 429);
  at += 15 * 60 * 1000; assert.equal(auth.login(password, 'attacker').status, 200);
});


test('public demo opens without a login and keeps CSRF and paid-provider restrictions', async () => {
  assert.throws(() => hostingSettings({...env, HOST_PUBLIC_DEMO: 'true', HOST_ENABLE_AI: 'true'}));
  const app = await fixture({env: {...env, HOST_PUBLIC_DEMO: 'true', HOST_OWNER_PASSWORD: undefined}});
  try {
    const page = await app.request('/business.html');
    assert.equal(page.status, 200);
    const cookie = page.headers.get('set-cookie').split(';')[0];
    const state = await (await app.request('/auth/session', {cookie})).json();
    assert.equal(state.public_demo, true); assert.equal(state.authenticated, false);
    assert.equal((await app.request('/auth/login')).headers.get('location'), '/business.html');
    const opts = {cookie, method: 'POST', headers: {Origin: env.APP_ORIGIN, 'Content-Type': 'application/json'}, body: '{}'};
    assert.equal((await app.request('/api/purchasing/orders', opts)).status, 403);
    assert.equal((await app.request('/api/purchasing/orders', {...opts, csrf: state.csrf_token})).status, 200);
    assert.equal((await app.request('/api/procurement/estimates', {...opts, csrf: state.csrf_token})).status, 403);
  } finally {await app.stop();}
});
