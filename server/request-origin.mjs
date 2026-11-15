/** Production uses one configured HTTPS origin; local Vite keeps its old origin. */
export function requestOriginAllowed(req, env = {}) {
  if (!req.headers.origin) return true;
  return req.headers.origin === (env.APP_ORIGIN || `http://${req.headers.host}`);
}
