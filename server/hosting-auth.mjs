import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const token = () => randomBytes(32).toString('base64url');
const equal = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); };

export function hostingSettings(env = process.env) {
  let origin;
  try {
    const url = new URL(env.APP_ORIGIN);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error();
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error();
    origin = url.origin;
  } catch { throw new Error('APP_ORIGIN must be an HTTPS origin, or HTTP loopback for local verification.'); }
  const publicDemo = env.HOST_PUBLIC_DEMO === 'true';
  if (publicDemo && (env.HOST_ENABLE_AI === 'true' || env.HOST_ENABLE_CARRIERS === 'true')) throw new Error('External paid providers must be disabled in the public demo.');
  if (!publicDemo && (typeof env.HOST_OWNER_PASSWORD !== 'string' || env.HOST_OWNER_PASSWORD.length < 24)) throw new Error('Set HOST_OWNER_PASSWORD to a random secret of at least 24 characters.');
  if (typeof env.HOST_SESSION_SECRET !== 'string' || env.HOST_SESSION_SECRET.length < 32) throw new Error('Set HOST_SESSION_SECRET to a random secret of at least 32 characters.');
  if (!env.LOGISTICS_API_TOKEN || env.LOGISTICS_API_TOKEN.length < 32) throw new Error('Set a private LOGISTICS_API_TOKEN of at least 32 characters.');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT is invalid.');
  const apiPort = Number(env.LOGISTICS_INTERNAL_PORT || 8001);
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) throw new Error('LOGISTICS_INTERNAL_PORT is invalid.');
  return {origin, port, apiPort, publicDemo, secure: origin.startsWith('https:'), password: env.HOST_OWNER_PASSWORD || token(),
    secret: env.HOST_SESSION_SECRET, apiToken: env.LOGISTICS_API_TOKEN,
    enableAI: env.HOST_ENABLE_AI === 'true', enableCarriers: env.HOST_ENABLE_CARRIERS === 'true',
    enableDemo: env.HOST_ENABLE_DEMO !== 'false'};
}

/** One owner, bounded memory, expiring opaque sessions. Restart deliberately logs out. */
export function createOwnerAuth(settings, {now = Date.now} = {}) {
  const sessions = new Map(), attempts = new Map();
  const name = settings.secure ? '__Host-logistics_owner' : 'logistics_owner_local';
  const mac = text => createHmac('sha256', settings.secret).update(text).digest('base64url');
  const expected = mac('password:' + settings.password);
  const maxAge = 8 * 60 * 60 * 1000;
  function prune() {
    for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
  }
  function cookie(value, clear = false) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; ${settings.secure ? 'Secure; ' : ''}Max-Age=${clear ? 0 : maxAge / 1000}`;
  }
  function lookup(req) {
    prune();
    const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1);
    if (!raw || raw.length > 200) return null;
    const [id, signature, extra] = raw.split('.');
    return !extra && equal(signature, mac(id)) ? sessions.get(id) || null : null;
  }
  function login(password, address) {
    prune();
    const key = String(address || 'unknown');
    const global = attempts.get('*') || {count: 0, until: now() + 15 * 60 * 1000};
    const entry = attempts.get(key) || {count: 0, until: now() + 15 * 60 * 1000};
    if (entry.count >= 5 || global.count >= 25) return {status: 429};
    entry.count++; global.count++; attempts.set(key, entry); attempts.set('*', global);
    if (attempts.size > 1000) attempts.delete(attempts.keys().next().value);
    if (typeof password !== 'string' || password.length > 1024 || !equal(mac('password:' + password), expected)) return {status: 401};
    attempts.delete(key);
    return issueSession();
  }
  function issueSession() {
    prune();
    if (sessions.size >= (settings.publicDemo ? 200 : 20)) sessions.delete(sessions.keys().next().value);
    const id = token(), session = {id, csrf: token(), expires: now() + maxAge};
    sessions.set(id, session);
    return {status: 200, cookie: cookie(id + '.' + mac(id)), session};
  }

  function csrf(req, session) {
    return req.headers.origin === settings.origin && !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) && equal(req.headers['x-csrf-token'], session?.csrf);
  }
  function logout(session) { if (session) sessions.delete(session.id); return cookie('', true); }
  return {lookup, login, csrf, logout, guest: issueSession, cookieName: name};
}
