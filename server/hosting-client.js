/* Injected only by the production gateway; local Vite pages are unchanged. */
(() => {
  const original = window.fetch.bind(window);
  const state = original('/auth/session', {cache: 'no-store'}).then(async response => {
    if (!response.ok) throw new Error('Please sign in again.');
    return response.json();
  });
  state.catch(() => {});
  window.fetch = async (input, options) => {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), options);
    const url = new URL(request.url);
    const protectedRequest = url.origin === location.origin && (url.pathname.startsWith('/api/') || url.pathname === '/auth/logout');
    let next = request;
    if (protectedRequest && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const headers = new Headers(request.headers);
      headers.set('X-CSRF-Token', (await state).csrf_token);
      next = new Request(request, {headers});
    }
    const response = await original(next);
    if (protectedRequest && response.status === 401) location.assign('/auth/login?next=' + encodeURIComponent(location.pathname));
    return response;
  };
  const show = async () => {
    try {
      const session = await state;
      const strip = document.createElement('div');
      strip.setAttribute('aria-label', 'Hosted owner session');
      strip.style.cssText = 'display:flex;gap:16px;align-items:center;justify-content:flex-end;padding:8px 24px;background:#edf2dd;color:#153f36;font:12px sans-serif';
      const note = document.createElement('span');
      note.textContent = 'Owner workspace · AI ' + (session.features.ai ? 'enabled' : 'disabled') + ' · carrier calls ' + (session.features.carriers ? 'enabled' : 'disabled');
      const logout = document.createElement('button');
      logout.type = 'button'; logout.textContent = 'Sign out';
      logout.addEventListener('click', async () => { logout.disabled = true; try { await window.fetch('/auth/logout', {method: 'POST'}); location.assign('/auth/login'); } catch { logout.disabled = false; } });
      if (session.public_demo) { note.textContent = 'Public demo · shared fictional data'; strip.append(note); } else strip.append(note, logout);
      document.body.prepend(strip);
    } catch { location.assign('/auth/login'); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, {once: true}); else void show();
})();
