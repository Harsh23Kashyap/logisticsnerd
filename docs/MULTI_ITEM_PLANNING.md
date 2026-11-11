# Multi-item procurement planning

Open `/procurement-plan.html` on the local Vite dev/preview server. This is a
separate local planning page, not a new purchasing or provider endpoint. The
original one-item demo and AI/provider flows are unchanged.

The fictional sample covers chairs and paper. Paste `{ "request": ..., "quotes": ... }`
using the existing `ProcurementRequest` and `SupplierQuote` fields, select a
preference, and click Review basket. The page keeps data in memory only. It
contacts no suppliers and creates no orders, reservations, labels or payments.
It has a 250,000-character input limit. Domain calls allow 1-100 items, at most
500 quotes, and the existing 3-5 selected suppliers.

## Policy

- Each requested item is matched by its unique ID, not its display name or array
  position. A supplier has at most one quote and one line per requested item.
  Missing lines mean no offer for that item, not zero price or availability.
- Each item needs one whole-line offer with enough quantity and delivery no later
  than its own deadline. Two insufficient supplier quantities are never combined.
- Lowest-cost selection chooses the cheapest feasible line, then delivery date.
  Earliest-delivery selection chooses the earliest feasible line, then cost.
  Exact ties remain listed; the displayed selection follows supplier-ID order.
- A basket budget applies to the sum, not independently to each item. An incomplete
  basket has no complete total or budget pass. Partial selections stay visible as
  review material, not a funded plan.
- Cheapest independent-line selection minimizes the sum only under independent
  offer pricing with all charges included. No bundle discounts, supplier shipping
  minimums, cross-item stock sharing, substitutions or split quantities are modeled.
- An over-budget earliest plan does not prove there is no cheaper feasible basket.
  Switch to lowest cost to review that independent-line alternative. No trade-off
  solver silently changes the user's preference.
- Every price and summed total must fit safe integer cents. Currency is the existing
  demo's USD assumption; currency conversion and taxes/extra fees are not added.

The planner does not integrate LogisticsNerd into OperationsNerd, infer company
mapping, import orders or replace the awaited module adapter. This is an additive
local buyer decision tool aligned with the brief's multi-item request/quote model.

## Checks

`npm test -- --run tests/multi-item.test.ts` covers multi-supplier line selection,
whole-line quantity, missing lines, duplicate/unknown identities, basket budgets,
exact ties, earliest-over-budget caveat, safe sums and unchanged inputs.
`npm test` retains all existing one-item/provider/cache/shipping tests. `npm run
build` checks TypeScript and all page entry points. Desktop/mobile browser checks
exercise the fictional complete basket, over-budget state, malformed JSON and
sample reset. Simulated prices are not live quotes or market validation.
