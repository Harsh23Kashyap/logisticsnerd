/** Independent whole-line procurement planning. No split quantities or orders. */
import type { ProcurementRequest, SupplierQuote, PurchasingPreference, ComparisonResult } from './model';
import { compareQuotes } from './compare';
import { validateComparisonInput } from './validate';

export interface ItemPlan { itemId: string; itemName: string; comparison: ComparisonResult; }
export interface ProcurementPlan {
  preference: PurchasingPreference;
  outcome: 'complete' | 'over_budget' | 'incomplete';
  items: ItemPlan[];
  selected: { itemId: string; supplierId: string; quoteId: string; totalCents: number; expectedDate: string }[];
  totalCents: number | null;
  budgetCents: number | null;
  budgetExceeded: boolean | null;
  unresolvedItemIds: string[];
  interpretation: string;
}

export function planProcurement(request: ProcurementRequest, quotes: SupplierQuote[], preference: PurchasingPreference = 'lowest_cost'): ProcurementPlan {
  if (!Array.isArray(request.items) || request.items.length < 1 || request.items.length > 100) throw new Error('Supply 1-100 requested items.');
  if (new Set(request.items.map(i => i.id)).size !== request.items.length) throw new Error('Requested item IDs must be distinct.');
  if (quotes.length > 500) throw new Error('Supply at most 500 quotes.');
  const itemIds = new Set(request.items.map(i => i.id));
  const quoteIds = new Set<string>();
  const supplierIds = new Set<string>();
  for (const quote of quotes) {
    if (!quote.id || quoteIds.has(quote.id) || supplierIds.has(quote.supplierId)) throw new Error('Supply one distinct quote per selected supplier.');
    if (quote.requestId !== request.id || !request.selectedSupplierIds.includes(quote.supplierId)) throw new Error('Quote does not belong to the selected request.');
    if (!Array.isArray(quote.items) || quote.items.length > request.items.length) throw new Error('Invalid quote item list.');
    const seen = new Set<string>();
    for (const line of quote.items) {
      if (!itemIds.has(line.requestedItemId) || seen.has(line.requestedItemId)) throw new Error('Quote has an unknown or duplicate requested item.');
      seen.add(line.requestedItemId);
    }
    quoteIds.add(quote.id); supplierIds.add(quote.supplierId);
  }
  const plans: ItemPlan[] = request.items.map(item => {
    // Budget is a basket constraint, never applied independently to each line.
    const lineRequest = { ...request, maxBudgetCents: null, items: [item] };
    const lineQuotes = quotes.filter(q => q.items.some(line => line.requestedItemId === item.id))
      .map(q => ({ ...q, items: q.items.filter(line => line.requestedItemId === item.id) }));
    validateComparisonInput({ ...lineRequest, maxBudgetCents: request.maxBudgetCents }, lineQuotes);
    return { itemId: item.id, itemName: item.name, comparison: compareQuotes(lineRequest, lineQuotes, preference) };
  });
  const selected: ProcurementPlan['selected'] = [];
  const unresolvedItemIds: string[] = [];
  let totalCents = 0;
  for (const plan of plans) {
    const best = plan.comparison.feasible[0];
    if (!best) { unresolvedItemIds.push(plan.itemId); continue; }
    totalCents += best.totalCents;
    if (!Number.isSafeInteger(totalCents)) throw new Error('Basket total is too large to compare accurately.');
    selected.push({ itemId: plan.itemId, supplierId: best.supplierId, quoteId: best.quoteId, totalCents: best.totalCents, expectedDate: best.expectedDate });
  }
  const complete = unresolvedItemIds.length === 0;
  const budgetExceeded = complete ? request.maxBudgetCents !== null && totalCents > request.maxBudgetCents : null;
  return { preference, outcome: !complete ? 'incomplete' : budgetExceeded ? 'over_budget' : 'complete', items: plans, selected,
    totalCents: complete ? totalCents : null, budgetCents: request.maxBudgetCents, budgetExceeded, unresolvedItemIds,
    interpretation: preference === 'lowest_cost'
      ? 'Cheapest independently feasible whole line per item. Sum assumes independent offers and all charges included. No split quantities, supplier bundle pricing, commitment or purchase.'
      : 'Earliest independently feasible whole line per item, then cost. An over-budget earliest plan does not establish that no cheaper basket exists. No split quantities, commitment or purchase.' };
}
