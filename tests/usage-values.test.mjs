import { describe, expect, it } from 'vitest';
import { createEstimateRunner } from '../server/procurement.mjs';

const suppliers = ['a', 'b', 'c'].map(id => ({ id, name: id }));
const request = {
  request: { id: 'r', buyerId: 'b', createdAt: '2026-11-13', maxBudgetCents: null,
    selectedSupplierIds: ['a', 'b', 'c'],
    items: [{ id: 'i', name: 'chairs', quantity: 1, requiredDate: '2026-11-20' }] },
  suppliers, preference: 'lowest_cost',
};
const output = { status: 'estimated', clarification: null, assumptions: [],
  quotes: ['a', 'b', 'c'].map(supplier_id => ({ supplier_id, available_quantity: 1,
    total_cents: 100, expected_delivery_date: '2026-11-15' })) };

async function estimate(usage, options = {}) {
  const run = createEstimateRunner({
    env: { BASETEN_DEEPSEEK_API_KEY: 'fictional-not-a-real-key' }, catalog: suppliers,
    rules: { validateComparisonInput: () => {}, compareQuotes: () => ({}) },
    now: () => new Date('2026-11-13T12:00:00Z'),
    fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop',
      message: { content: JSON.stringify(output) } }], usage }), { status: 200 }),
    ...options,
  });
  const result = await run(request);
  return options.returnResponse ? result : result.provenance.usage;
}

describe('provider token usage', () => {
  for (const field of ['prompt_tokens', 'completion_tokens']) {
    for (const value of [-1, -10, 1.5, '12', null, Number.MAX_SAFE_INTEGER + 1]) {
      it(`normalizes invalid ${field} ${String(value)}`, async () => {
        const usage = { prompt_tokens: 7, completion_tokens: 8, [field]: value };
        expect(await estimate(usage)).toEqual({
          inputTokens: field === 'prompt_tokens' ? null : 7,
          outputTokens: field === 'completion_tokens' ? null : 8,
        });
      });
    }
  }
  it('preserves zero usage', async () => {
    expect(await estimate({ prompt_tokens: 0, completion_tokens: 0 }))
      .toEqual({ inputTokens: 0, outputTokens: 0 });
  });
  it('preserves maximum safe integer usage', async () => {
    expect(await estimate({ prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 9 }))
      .toEqual({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 9 });
  });
  it('handles missing usage', async () => {
    expect(await estimate(undefined)).toEqual({ inputTokens: null, outputTokens: null });
  });
});


describe('normalized usage after a cold persistent-cache read', () => {
  for (const invalid of [-1, -10, 1.5, '12', null]) {
    for (const field of ['prompt_tokens', 'completion_tokens']) {
      it(`reuses the saved result for ${field} ${String(invalid)}`, async () => {
        const values = new Map();
        const locks = new Map();
        const cache = {
          configured: () => true,
          get: async key => values.get(key) ?? null,
          acquire: async (key, token) => { locks.set(key, token); return true; },
          release: async key => { locks.delete(key); return true; },
          complete: async (lockKey, token, dataKey, value) => {
            if (locks.get(lockKey) !== token) return false;
            values.set(dataKey, value);
            locks.delete(lockKey);
            return true;
          },
        };
        const usage = { prompt_tokens: 7, completion_tokens: 8, [field]: invalid };
        const first = await estimate(usage, { persistentCache: cache, returnResponse: true });
        const second = await estimate(usage, { persistentCache: cache, returnResponse: true,
          fetcher: async () => { throw new Error('Cold cache read must not generate again'); } });
        expect(second.provenance.cached).toBe(true);
        expect(first.provenance.cached).toBe(false);
        expect(second.provenance.usage).toEqual(first.provenance.usage);
        expect(values.size).toBe(1);
        expect(locks.size).toBe(0);
      });
    }
  }
});
