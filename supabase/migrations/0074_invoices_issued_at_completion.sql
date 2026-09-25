-- 0074 — The invoice is issued when the job is done, not when someone asks
--
-- `issue_zatca_invoice` (0030) has existed since Phase 6 and nothing called
-- it: not the state machine, not the capture, not the app. Only the tests
-- did. So no customer ever had an invoice to open, and the one way to get one
-- was an RPC granted to every authenticated user that never checked whose
-- order it was invoicing — anyone could issue the tax document for somebody
-- else's job (reading it stayed protected by RLS; issuing did not).
--
-- Now:
--   1. An AFTER trigger issues it when an order becomes `completed` — by the
--      customer, by the auto-close (0071), by ops resolving a dispute —
--      provided there is something to invoice (a warranty re-service is free
--      and gets none) and a seller is configured (ADR-0009: Habba, until that
--      decision says otherwise; the console edits `invoice_sellers`).
--   2. Invoicing never blocks completion. A seller misconfigured in the
--      console (a legal name over 127 bytes, say) must not stop a customer
--      closing a job and the payment being captured; the order completes, the
--      invoice is missing, and the console shows the order without one —
--      where `ops_issue_invoice` issues it once the seller is fixed.
--   3. The raw function is no longer callable by clients.

create or replace function public.issue_invoice_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.total_amount, 0) = 0 then
    return new;
  end if;

  if not exists (select 1 from public.invoice_sellers s where s.provider_id is null and s.is_active) then
    return new;
  end if;

  if exists (select 1 from public.zatca_invoices i where i.order_id = new.id) then
    return new;
  end if;

  begin
    perform public.issue_zatca_invoice(new.id);
  exception when others then
    raise warning 'Order % completed without an invoice: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create trigger orders_z_issue_invoice
  after update of status on public.orders
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.issue_invoice_on_completion();

alter table public.orders enable always trigger orders_z_issue_invoice;

revoke execute on function public.issue_zatca_invoice(uuid) from public, anon, authenticated;
grant execute on function public.issue_zatca_invoice(uuid) to service_role;


-- For the order the trigger could not invoice. Same checks as ever (completed,
-- not zero, not already invoiced) — they live in issue_zatca_invoice.
create or replace function public.ops_issue_invoice(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  return public.issue_zatca_invoice(p_order_id);
end;
$$;

revoke execute on function public.ops_issue_invoice(uuid) from public, anon;
grant execute on function public.ops_issue_invoice(uuid) to authenticated;

-- An invoice issued from the console is an operator's change like any other
-- (§5.1.6): recorded by the same trigger the other audited tables carry. It
-- records nothing for the invoices completion issues — those are no one's act.
create trigger zatca_invoices_z_audit_ops
  after insert or update or delete on public.zatca_invoices
  for each row execute function public.audit_ops_change();
