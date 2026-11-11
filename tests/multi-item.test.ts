import { describe, it, expect } from 'vitest';
import type { ProcurementRequest, SupplierQuote } from '../src/domain/model';
import { planProcurement } from '../src/domain/multi-item';
function fixture(): {request:ProcurementRequest;quotes:SupplierQuote[]} {
  const request:ProcurementRequest={id:'r',buyerId:'b',createdAt:'2026-11-11',maxBudgetCents:null,selectedSupplierIds:['A','B','C'],items:[
    {id:'chairs',name:'Chairs',quantity:2,requiredDate:'2026-12-01'}, {id:'paper',name:'Paper',quantity:5,requiredDate:'2026-11-25'}]};
  const quotes:SupplierQuote[]=['A','B','C'].map((supplierId,i)=>({id:'q'+supplierId,requestId:'r',supplierId,submittedAt:'2026-11-11',items:[
    {requestedItemId:'chairs',availableQuantity:2,price:{kind:'unit',cents:1000+i*100},expectedDate:i===1?'2026-11-20':'2026-11-24'},
    {requestedItemId:'paper',availableQuantity:5,price:{kind:'total',cents:700-i*100},expectedDate:i===1?'2026-11-20':'2026-11-24'}]}));
  return {request,quotes};
}
describe('independent whole-line basket plan',()=>{
 it('selects different suppliers per item and sums exact cents',()=>{const {request,quotes}=fixture();const p=planProcurement(request,quotes);expect(p.outcome).toBe('complete');expect(p.selected.map(x=>x.supplierId)).toEqual(['A','C']);expect(p.totalCents).toBe(2500);});
 it('allows exact basket budget equality',()=>{const {request,quotes}=fixture();request.maxBudgetCents=2500;expect(planProcurement(request,quotes).budgetExceeded).toBe(false);});
 it('rejects basket one cent over even if each line fits',()=>{const {request,quotes}=fixture();request.maxBudgetCents=2499;const p=planProcurement(request,quotes);expect(p.outcome).toBe('over_budget');expect(p.items.every(x=>x.comparison.outcome==='recommended')).toBe(true);});
 it('does not claim partial totals are a complete basket',()=>{const {request,quotes}=fixture();for(const q of quotes)q.items.pop();const p=planProcurement(request,quotes);expect(p.outcome).toBe('incomplete');expect(p.totalCents).toBe(null);expect(p.budgetExceeded).toBe(null);expect(p.unresolvedItemIds).toEqual(['paper']);});
 it('does not use another item quote or name matching',()=>{const {request,quotes}=fixture();request.items[1].name=request.items[0].name;for(const q of quotes)q.items.pop();expect(planProcurement(request,quotes).unresolvedItemIds).toEqual(['paper']);});
 it('preserves single-item policy and offers',()=>{const {request,quotes}=fixture();request.items.pop();for(const q of quotes)q.items.pop();const p=planProcurement(request,quotes);expect(p.totalCents).toBe(2000);expect(p.selected[0].supplierId).toBe('A');});
 it('does not combine two insufficient quantities',()=>{const {request,quotes}=fixture();for(const q of quotes)q.items[0].availableQuantity=1;expect(planProcurement(request,quotes).unresolvedItemIds).toContain('chairs');});
 it('collects quantity and deadline failures per line',()=>{const {request,quotes}=fixture();quotes[0].items[0].availableQuantity=0;quotes[0].items[0].expectedDate='2026-12-02';expect(planProcurement(request,quotes).items[0].comparison.evaluations[0].rejections.map(x=>x.code)).toEqual(['quantity','deadline']);});
 it('earliest preference can cost more without claiming no affordable plan',()=>{const {request,quotes}=fixture();request.maxBudgetCents=2500;const p=planProcurement(request,quotes,'earliest_delivery');expect(p.selected.map(x=>x.supplierId)).toEqual(['B','B']);expect(p.outcome).toBe('over_budget');expect(p.interpretation).toContain('does not establish');});
 it('preserves all ties and uses stable supplier order for displayed selection',()=>{const {request,quotes}=fixture();quotes[1].items[0]={...quotes[0].items[0],price:{kind:'unit',cents:1000}};const p=planProcurement(request,quotes);expect(p.items[0].comparison.recommendedSupplierIds).toEqual(['A','B']);expect(p.selected[0].supplierId).toBe('A');});
 it('does not mutate caller inputs',()=>{const f=fixture();const before=JSON.stringify(f);planProcurement(f.request,f.quotes);expect(JSON.stringify(f)).toBe(before);});
 it('supports no submitted offers without fake winners',()=>{const {request}=fixture();const p=planProcurement(request,[]);expect(p.selected).toEqual([]);expect(p.items.every(x=>x.comparison.outcome==='no_quotes')).toBe(true);});
 it.each(['duplicate_item','unknown_quote_item','duplicate_quote_item','duplicate_supplier','wrong_request','unselected_supplier'])('refuses ambiguous identity %s',kind=>{const {request,quotes}=fixture();if(kind==='duplicate_item')request.items[1].id='chairs';if(kind==='unknown_quote_item')quotes[0].items[0].requestedItemId='x';if(kind==='duplicate_quote_item')quotes[0].items[1].requestedItemId='chairs';if(kind==='duplicate_supplier')quotes[1].supplierId='A';if(kind==='wrong_request')quotes[0].requestId='other';if(kind==='unselected_supplier')quotes[0].supplierId='X';expect(()=>planProcurement(request,quotes)).toThrow();});
 it.each([NaN,Infinity,-1,0.1])('rejects invalid budget %s',budget=>{const {request,quotes}=fixture();request.maxBudgetCents=budget;expect(()=>planProcurement(request,quotes)).toThrow();});
 it('rejects unsafe sum even when each line total is safe',()=>{const {request,quotes}=fixture();for(const q of quotes)for(const line of q.items)line.price={kind:'total',cents:Number.MAX_SAFE_INTEGER};expect(()=>planProcurement(request,quotes)).toThrow('Basket total');});
 it('accepts explicit zero-price basket with zero budget',()=>{const {request,quotes}=fixture();request.maxBudgetCents=0;for(const q of quotes)for(const line of q.items)line.price.cents=0;expect(planProcurement(request,quotes).totalCents).toBe(0);});
 it('handles quotes with empty item lists as nonresponses',()=>{const {request,quotes}=fixture();quotes[0].items=[];expect(planProcurement(request,quotes).selected.every(x=>x.supplierId!=='A')).toBe(true);});
 it('validates date and quantity even with no offers',()=>{const {request}=fixture();request.items[0].requiredDate='2026-02-30';expect(()=>planProcurement(request,[])).toThrow();});
});
