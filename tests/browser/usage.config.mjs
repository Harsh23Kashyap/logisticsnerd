import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createEstimateRunner } from '../../server/procurement.mjs';
import { compareQuotes } from '../../src/domain/compare.ts';
import { validateComparisonInput } from '../../src/domain/validate.ts';
import { suppliers } from '../../src/data.ts';

let calls = 0;
const values = new Map();
const locks = new Map();
const cache = {
  configured: () => true,
  get: async key => values.get(key) ?? null,
  acquire: async (key, token) => { locks.set(key, token); return true; },
  release: async key => { locks.delete(key); return true; },
  complete: async (lockKey, token, dataKey, value) => {
    if (locks.get(lockKey) !== token) return false;
    values.set(dataKey, value); locks.delete(lockKey); return true;
  },
};
export default defineConfig({plugins: [{name:'offline-browser-test',configureServer(server) {
  server.middlewares.use(async (req,res,next) => {
    if (!req.url.startsWith('/api/')) return next();
    const send = data => {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
    if (req.url === '/api/procurement/status') return send({configured:true});
    if (req.url === '/api/test/evidence') return send({calls, saved:[...values.values()].map(JSON.parse)});
    if (req.url !== '/api/procurement/estimates') {res.statusCode=404;return send({error:'Offline fixture route only'});}
    try {
      let text='';for await (const part of req) text+=part;
      const input=JSON.parse(text);
      const usage=JSON.parse(readFileSync(process.env.USAGE_FIXTURE_PATH,'utf8'));
      const run=createEstimateRunner({env:{BASETEN_DEEPSEEK_API_KEY:'test-only-no-real-key'},catalog:suppliers,
        rules:{compareQuotes,validateComparisonInput},persistentCache:cache,
        now:()=>new Date('2026-11-13T12:00:00Z'),
        fetcher:async()=>{
          calls++;
          const output={status:'estimated',clarification:null,assumptions:['Synthetic local browser fixture.'],
            quotes:input.request.selectedSupplierIds.map((supplier_id,i)=>({supplier_id,
              available_quantity:input.request.items[0].quantity,total_cents:10000+i*1000,
              expected_delivery_date:'2026-11-15'}))};
          return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage}),{status:200});
        }});
      send(await run(input));
    } catch(error) {res.statusCode=500;send({error:String(error)});}
  });
}}]});
