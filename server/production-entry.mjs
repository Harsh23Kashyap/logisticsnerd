import path from 'node:path';
import { createProductionServer } from './production-gateway.mjs';
import { hostingSettings } from './hosting-auth.mjs';
import { shippingMiddleware } from './middleware.mjs';
import { procurementMiddleware } from './procurement-middleware.mjs';
import { workflowDemoMiddleware } from './workflow-demo.mjs';
import { createEstimateRunner } from './procurement.mjs';
import { createRedisCache } from './redis-cache.mjs';
import { compareQuotes } from '../src/domain/compare.ts';
import { validateComparisonInput } from '../src/domain/validate.ts';
import { suppliers } from '../src/data.ts';

const settings = hostingSettings(process.env), root = process.env.APP_ROOT || process.cwd();
const getEnv = () => {
  const env = {...process.env, APP_ORIGIN: settings.origin};
  if (!settings.enableAI) for (const name of ['BASETEN_DEEPSEEK_API_KEY', 'BASETEN_GLM_FLASH_API_KEY', 'BASETEN_GLM_FAST_API_KEY']) delete env[name];
  if (!settings.enableCarriers) { delete env.EASYPOST_TEST_API_KEY; delete env.AFTERSHIP_API_KEY; env.SMKLOG_ENABLED = 'false'; env.AFTERSHIP_EDD_ENABLED = 'false'; }
  return env;
};
const estimatesFactory = catalog => {
  const cache = createRedisCache({getEnv});
  return {run: createEstimateRunner({env: getEnv, rules: {compareQuotes, validateComparisonInput}, catalog, pricing: 'unit', persistentCache: cache}), close: () => cache.close()};
};
const workflow = workflowDemoMiddleware({getEnv, allowAI: settings.enableAI, cwd: root,
  python: process.env.WORKFLOW_DEMO_PYTHON || 'python3', estimatesFactory});
const {server} = createProductionServer({env: process.env, staticDir: path.join(root, 'dist'),
  apiTarget: 'http://127.0.0.1:' + settings.apiPort,
  clientScript: path.join(root, 'server', 'hosting-client.js'),
  middlewares: [workflow, shippingMiddleware(getEnv), procurementMiddleware(getEnv, {compareQuotes, validateComparisonInput}, suppliers)]});
server.listen(settings.port, '0.0.0.0', () => console.log('LogisticsNerd production gateway listening.'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 10000).unref();
});
