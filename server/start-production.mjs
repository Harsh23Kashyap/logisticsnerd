import { spawn } from 'node:child_process';
import path from 'node:path';
import { hostingSettings } from './hosting-auth.mjs';

let settings;
try { settings = hostingSettings(process.env); } catch (error) { console.error(error.message); process.exit(1); }
const root = process.env.APP_ROOT || process.cwd(), children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 11000).unref();
  const check = setInterval(() => { if (!children.size) { clearInterval(check); process.exit(code); } }, 100);
}
function start(command, args) {
  const child = spawn(command, args, {cwd: root, env: process.env, stdio: ['ignore', 'inherit', 'inherit']});
  children.add(child);
  child.once('error', () => { console.error('A private application process could not start.'); children.delete(child); stop(1); });
  child.once('exit', () => { children.delete(child); if (!stopping) { console.error('An application process stopped; shutting down its companion.'); stop(1); } });
}
if (process.env.HOST_BOOTSTRAP === '1') {
  const result = await new Promise(resolve => {
    const child = spawn(process.env.WORKFLOW_DEMO_PYTHON || 'python3', ['-m', 'logistics_persistence.hosting', 'initialize-fresh'], {cwd: root, env: process.env, stdio: ['ignore', 'inherit', 'inherit']});
    child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1));
  });
  if (result !== 0) { console.error('Hosted initialization refused. Review the private database and run an explicit backed-up migration if needed.'); process.exit(1); }
}
start(process.env.WORKFLOW_DEMO_PYTHON || 'python3', ['-m', 'uvicorn', 'logistics_persistence.api:app', '--host', '127.0.0.1', '--port', String(settings.apiPort), '--no-access-log']);
start(process.execPath, [path.join(root, 'dist-server', 'server.mjs')]);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(0));
