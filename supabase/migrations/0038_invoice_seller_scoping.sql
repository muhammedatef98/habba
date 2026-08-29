-- 0038 — invoice_sellers: row-scope, not global read
--
-- Follow-up to 0037, closing the two items its own review left unverified.
--
-- `zatca_invoices_read` (0030) was checked and is fine as written: it already
-- matches the order_events/order_parts shape — customer-match OR
-- provider-match OR ops, through the order relationship. No change here.
--
-- `invoice_sellers_read` (0030) is `using (true)`, justified at the time as
-- "the seller's legal name and VAT number appear on every invoice, so they
-- are not secret." That holds for the one row a customer's OWN invoice
-- actually names. It does not justify letting any authenticated client
-- enumerate every seller row that exists.
--
-- `provider_id` is nullable specifically so this table can hold a per-provider
-- row once ADR-0009 (seller of record) resolves toward per-provider
-- self-billing — `issue_zatca_invoice` already comments "this is where the
-- per-provider lookup goes." No such row is seeded today, but the column
-- exists so that a future row tied to one provider's VAT/CR identity is
-- expected, not hypothetical, and `using (true)` would expose it to every
-- client the moment it is written — the same shape of over-grant `providers`
-- had before 0037, just row-level instead of column-level.
--
-- There is no discovery use case for this table the way there is for
-- `providers` (nobody browses sellers), so row-scoping is sufficient — no
-- column revoke needed. Three legitimate readers:
--   * the single shared Habba row (provider_id is null) — still genuinely
--     not secret, and still needed by every customer's invoice display;
--   * a provider reading their own future self-billing entity;
--   * a customer or provider reading the seller on an invoice that is
--     actually theirs, via the same join zatca_invoices_read already uses.

drop policy if exists invoice_sellers_read on public.invoice_sellers;

create policy invoice_sellers_read on public.invoice_sellers
  for select to authenticated using (
    provider_id is null
    or provider_id = public.current_provider_id()
    or exists (
      select 1 from public.zatca_invoices i
      join public.orders o on o.id = i.order_id
      where i.seller_id = invoice_sellers.id
        and (o.customer_id = auth.uid() or o.provider_id = public.current_provider_id())
    )
    or public.is_ops()
  );
