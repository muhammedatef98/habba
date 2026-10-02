-- 0096 — A refund gets its credit note (إشعار دائن)
--
-- Since 0074 a completed order issues a simplified tax invoice, and since
-- 0070 an operator can refund all or part of it by resolving a dispute. The
-- refund lowered `orders.refunded_amount` and nothing else: the tax record
-- still said the customer paid the full amount, and the seller's VAT return
-- would have declared VAT on money handed back. ZATCA's answer to "the
-- supply was reduced after invoicing" is a credit note that names the
-- original invoice, states the reason, and carries its own QR. This issues
-- one.
--
--   1. A credit note is issued for every increase in `refunded_amount` on an
--      invoiced order — by the trigger on orders, whoever made the refund.
--   2. A refund can come BEFORE the invoice: a dispute opened while the job
--      awaited approval is refunded, then resolved to `completed`, and only
--      that completion issues the invoice (0074), for the full total. So an
--      invoice issued for an order that already carries a refund is credited
--      for it at once, by the trigger on invoices.
--   3. The VAT is split at the invoice's own rate, and the note that brings
--      the credited total to the invoice total takes exactly the VAT that is
--      left — so a full refund reverses the invoice to the halala, however
--      the partial notes before it rounded.
--   4. Like the invoice, a credit note never blocks the refund it records. A
--      refund that could not be credited (a seller made unissuable in the
--      console, say) is left for `ops_issue_credit_notes`, which issues
--      whatever is owed — and is idempotent, so running it twice owes nothing.
--   5. Notes are numbered on their own gapless series, HB-CRN-YYYY-NNNNNN,
--      and read by exactly whoever can read the invoice they credit.
--
-- The QR is the same Phase 1 TLV as the invoice (0030) with the credited
-- amounts. Phase 2 (UBL XML, cryptographic stamp, clearance) waits on
-- ADR-0009 for credit notes exactly as it does for invoices.

create table public.zatca_credit_notes (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.zatca_invoices(id) on delete restrict,
  order_id           uuid not null references public.orders(id) on delete restrict,
  -- The seller of the invoice it credits, snapshotted: a credit note is
  -- issued by the party that issued the invoice, not by whoever is the
  -- default seller on the day of the refund.
  seller_id          uuid not null references public.invoice_sellers(id) on delete restrict,

  credit_note_number text not null unique,
  reason_ar          text not null check (length(btrim(reason_ar)) > 0),

  net_amount         numeric(12,2) not null check (net_amount >= 0),
  vat_amount         numeric(12,2) not null check (vat_amount >= 0),
  total_amount       numeric(12,2) not null check (total_amount > 0),
  vat_rate           numeric(5,4) not null,

  qr_base64          text not null,
  credit_note_xml    text,          -- UBL 2.1; Phase 2 work, as on invoices
  credit_note_hash   text,

  issued_at          timestamptz not null default now(),

  constraint zatca_credit_notes_totals_reconcile check (
    total_amount = net_amount + vat_amount
  )
);

create index zatca_credit_notes_invoice_idx on public.zatca_credit_notes (invoice_id, issued_at);
create index zatca_credit_notes_order_idx on public.zatca_credit_notes (order_id);
create index zatca_credit_notes_seller_idx on public.zatca_credit_notes (seller_id, issued_at desc);

create sequence if not exists public.credit_note_number_seq;
revoke all on sequence public.credit_note_number_seq from public, anon, authenticated;


-- Issues the one credit note `p_amount` (VAT-inclusive) calls for against the
-- order's invoice. Internal: called by the triggers below and by the ops
-- catch-up, never by a client.
create or replace function public.issue_zatca_credit_note(
  p_order_id uuid,
  p_amount   numeric,
  p_reason   text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice   record;
  v_seller    record;
  v_amount    numeric(12,2) := round(coalesce(p_amount, 0), 2);
  v_prev      numeric(12,2);
  v_prev_vat  numeric(12,2);
  v_vat       numeric(12,2);
  v_number    text;
  v_id        uuid;
  v_now       timestamptz := now();
begin
  if v_amount <= 0 then
    raise exception 'A credit note is for more than nothing' using errcode = 'check_violation';
  end if;

  -- Locked: two refunds landing together must not both read the same
  -- "credited so far" and over-credit the invoice between them.
  select * into v_invoice from public.zatca_invoices i where i.order_id = p_order_id for update;
  if v_invoice is null then
    raise exception 'Order % has no invoice to credit', p_order_id using errcode = 'no_data_found';
  end if;

  select coalesce(sum(c.total_amount), 0), coalesce(sum(c.vat_amount), 0)
    into v_prev, v_prev_vat
    from public.zatca_credit_notes c where c.invoice_id = v_invoice.id;

  if v_prev + v_amount > v_invoice.total_amount then
    raise exception 'Credit of % SAR would exceed invoice % (% SAR, % already credited)',
      v_amount, v_invoice.invoice_number, v_invoice.total_amount, v_prev
      using errcode = 'check_violation';
  end if;

  if v_prev + v_amount = v_invoice.total_amount then
    -- The last of it: whatever VAT is still on the invoice, so the notes
    -- reverse it exactly rather than to within the rounding of each.
    v_vat := v_invoice.vat_amount - v_prev_vat;
  else
    v_vat := round(v_amount * v_invoice.vat_rate / (1 + v_invoice.vat_rate), 2);
  end if;

  select * into v_seller from public.invoice_sellers s where s.id = v_invoice.seller_id;

  v_number := format('HB-CRN-%s-%s',
                     to_char(v_now at time zone 'Asia/Riyadh', 'YYYY'),
                     lpad(nextval('public.credit_note_number_seq')::text, 6, '0'));

  insert into public.zatca_credit_notes (
    invoice_id, order_id, seller_id, credit_note_number, reason_ar,
    net_amount, vat_amount, total_amount, vat_rate, qr_base64, issued_at
  ) values (
    v_invoice.id, p_order_id, v_seller.id, v_number,
    coalesce(nullif(btrim(p_reason), ''), 'استرداد مبلغ للعميل'),
    v_amount - v_vat, v_vat, v_amount, v_invoice.vat_rate,
    public.zatca_qr(v_seller.legal_name_ar, v_seller.vat_number, v_now, v_amount, v_vat),
    v_now
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.issue_zatca_credit_note(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.issue_zatca_credit_note(uuid, numeric, text) to service_role;


-- What the refunds on an order still owe in credit notes: refunded so far,
-- less what has been credited, never more than the invoice. Zero for an
-- order with no invoice — there is nothing yet to credit against.
create or replace function public.credit_owed(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
           least(o.refunded_amount, i.total_amount)
             - coalesce((select sum(c.total_amount) from public.zatca_credit_notes c
                          where c.invoice_id = i.id), 0),
           0)::numeric(12,2)
    from public.orders o
    join public.zatca_invoices i on i.order_id = o.id
   where o.id = p_order_id;
$$;

revoke execute on function public.credit_owed(uuid) from public, anon, authenticated;
grant execute on function public.credit_owed(uuid) to service_role;


-- The reason a refund was made, as the customer was told it: the latest
-- resolved dispute's note, else a plain default.
create or replace function public.credit_note_reason(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select format('استرداد بعد مراجعة شكوى: %s', d.resolution_note)
       from public.order_disputes d
      where d.order_id = p_order_id and d.refund_amount > 0
      order by d.resolved_at desc nulls last, d.opened_at desc
      limit 1),
    'استرداد مبلغ للعميل');
$$;

revoke execute on function public.credit_note_reason(uuid) from public, anon, authenticated;
grant execute on function public.credit_note_reason(uuid) to service_role;


-- Both triggers issue whatever is owed and swallow a failure into a warning:
-- the refund (or the completion that issued the invoice) has already
-- happened and is correct; a missing credit note is what ops_issue_credit_notes
-- is for, and the console shows it.
create or replace function public.issue_owed_credit_note(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owed numeric(12,2) := coalesce(public.credit_owed(p_order_id), 0);
begin
  if v_owed > 0 then
    perform public.issue_zatca_credit_note(p_order_id, v_owed, public.credit_note_reason(p_order_id));
  end if;
end;
$$;

revoke execute on function public.issue_owed_credit_note(uuid) from public, anon, authenticated;
grant execute on function public.issue_owed_credit_note(uuid) to service_role;


create or replace function public.credit_note_on_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.issue_owed_credit_note(new.id);
  exception when others then
    raise warning 'Order % was refunded without a credit note: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger orders_z_credit_note_on_refund
  after update of refunded_amount on public.orders
  for each row
  when (new.refunded_amount > old.refunded_amount)
  execute function public.credit_note_on_refund();

alter table public.orders enable always trigger orders_z_credit_note_on_refund;


create or replace function public.credit_note_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.issue_owed_credit_note(new.order_id);
  exception when others then
    raise warning 'Invoice % was issued for a refunded order without a credit note: %',
      new.invoice_number, sqlerrm;
  end;
  return null;
end;
$$;

create trigger zatca_invoices_z_credit_note
  after insert on public.zatca_invoices
  for each row execute function public.credit_note_on_invoice();

alter table public.zatca_invoices enable always trigger zatca_invoices_z_credit_note;

-- Trigger functions are not a client API (0091).
revoke execute on function public.credit_note_on_refund() from public, anon, authenticated;
revoke execute on function public.credit_note_on_invoice() from public, anon, authenticated;


-- For the refund the trigger could not credit: issues every note still owed,
-- across all orders or one. Returns how many it issued.
create or replace function public.ops_issue_credit_notes(p_order_id uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_count int := 0;
begin
  perform public.assert_ops();

  for v_order in
    select o.id from public.orders o
      join public.zatca_invoices i on i.order_id = o.id
     where o.refunded_amount > 0
       and (p_order_id is null or o.id = p_order_id)
  loop
    if coalesce(public.credit_owed(v_order), 0) > 0 then
      perform public.issue_owed_credit_note(v_order);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.ops_issue_credit_notes(uuid) from public, anon;
grant execute on function public.ops_issue_credit_notes(uuid) to authenticated;


-- Read exactly as the invoice is (0030): the customer, the provider who did
-- the job, ops. No write path for anyone but the functions above.
alter table public.zatca_credit_notes enable row level security;

create policy zatca_credit_notes_read on public.zatca_credit_notes
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = zatca_credit_notes.order_id
        and (o.customer_id = auth.uid() or o.provider_id = public.current_provider_id())
    )
    or public.is_ops()
  );

revoke all on public.zatca_credit_notes from anon;
revoke insert, update, delete, truncate on public.zatca_credit_notes from authenticated;
grant select on public.zatca_credit_notes to authenticated;

-- A tax document, once issued, is never edited or removed — by anyone.
create or replace function public.zatca_credit_notes_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A credit note is never changed or deleted; issue another'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.zatca_credit_notes_immutable() from public, anon, authenticated;

create trigger zatca_credit_notes_immutable
  before update or delete on public.zatca_credit_notes
  for each row execute function public.zatca_credit_notes_immutable();

alter table public.zatca_credit_notes enable always trigger zatca_credit_notes_immutable;

-- The order's page in the console shows its credit notes and whatever is
-- still owed. Wrapped as 0079 wrapped it, so nothing it returns changes.
alter function public.ops_order_detail(uuid) rename to ops_order_detail_0079;
revoke execute on function public.ops_order_detail_0079(uuid) from public, anon, authenticated;

create or replace function public.ops_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The wrapped chain asserts ops and records the read (0070).
  return public.ops_order_detail_0079(p_order_id)
    || jsonb_build_object(
         'credit_notes', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.id, 'credit_note_number', c.credit_note_number,
                    'reason_ar', c.reason_ar, 'net_amount', c.net_amount,
                    'vat_amount', c.vat_amount, 'total_amount', c.total_amount,
                    'issued_at', c.issued_at) order by c.issued_at), '[]'::jsonb)
             from public.zatca_credit_notes c where c.order_id = p_order_id),
         'credit_owed', coalesce(public.credit_owed(p_order_id), 0));
end;
$$;

revoke execute on function public.ops_order_detail(uuid) from public, anon;
grant execute on function public.ops_order_detail(uuid) to authenticated;

-- Issued by an operator's refund, so an operator's act (§5.1.6).
create trigger zatca_credit_notes_z_audit_ops
  after insert on public.zatca_credit_notes
  for each row execute function public.audit_ops_change();
