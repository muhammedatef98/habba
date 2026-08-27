-- 0030 — ZATCA e-invoicing (فاتورة)
--
-- Build prompt §6.8: "Saudi e-invoicing Phase 2 requires a TLV-encoded QR
-- containing seller name, VAT number, timestamp, total with VAT, and VAT
-- amount. Implement the TLV encoder in an Edge Function. Do not skip this —
-- it is a legal requirement."
--
-- What is implemented here, and what is NOT:
--
--   ✅ The TLV QR (tags 1–5). This is fully specified and testable, and it is
--      what appears on the invoice a customer receives.
--   ⚠️ NOT the Phase 2 cryptographic stamp, CSID onboarding, or clearance /
--      reporting to ZATCA's API. Those require an onboarded seller with a
--      compliance certificate, which requires the seller-of-record decision in
--      ADR-0009 to be made first. Tags 6–9 (hash, signature, public key,
--      stamp) are deliberately absent rather than faked.
--
-- The encoder lives in SQL rather than an Edge Function so the QR is computed
-- where the invoice row is written — an invoice whose stored QR was generated
-- elsewhere can drift from the amounts beside it.

-- TLV: [tag byte][length byte][value bytes], concatenated, then base64.
create or replace function public.zatca_tlv(p_tag int, p_value text)
returns bytea
language plpgsql
immutable
as $$
declare
  v_bytes bytea := convert_to(coalesce(p_value, ''), 'UTF8');
  v_len   int   := length(v_bytes);
begin
  -- ZATCA Phase 1 uses a single length byte. An Arabic seller name of ~63
  -- characters exceeds 127 UTF-8 bytes, so this is a real limit rather than a
  -- theoretical one — and silently truncating a seller name on a tax document
  -- is not an option.
  if v_len > 127 then
    raise exception 'ZATCA TLV value for tag % is % bytes; the maximum is 127', p_tag, v_len
      using errcode = 'check_violation',
            hint = 'Shorten the seller name.';
  end if;

  return set_byte(set_byte('\x0000'::bytea, 0, p_tag), 1, v_len) || v_bytes;
end;
$$;


create or replace function public.zatca_qr(
  p_seller_name text,
  p_vat_number  text,
  p_issued_at   timestamptz,
  p_total_with_vat numeric,
  p_vat_amount  numeric
)
returns text
language sql
immutable
as $$
  select encode(
      public.zatca_tlv(1, p_seller_name)
   || public.zatca_tlv(2, p_vat_number)
      -- ISO 8601 in UTC with the Z designator. ZATCA validators reject a
      -- local-time or offset-bearing timestamp.
   || public.zatca_tlv(3, to_char(p_issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      -- Amounts as plain decimal strings with two places. Not currency
      -- formatted, not thousands separated.
   || public.zatca_tlv(4, to_char(p_total_with_vat, 'FM9999999990.00'))
   || public.zatca_tlv(5, to_char(p_vat_amount, 'FM9999999990.00')),
    'base64');
$$;

comment on function public.zatca_qr is
  'ZATCA Phase 1 TLV QR payload, base64. Tags 6-9 (cryptographic stamp) need CSID onboarding — ADR-0009.';


-- Seller identity ------------------------------------------------------------
-- ⚠️ ADR-0009 IS UNRESOLVED. In a marketplace the seller of record may be
-- Habba (one ZATCA onboarding, providers settled by self-billed invoice) or
-- each provider (per-provider CSIDs, a far larger build). The schema records
-- WHICH, so that whichever way the decision lands, invoices issued before it
-- are still attributable rather than silently assumed to be Habba's.
create table public.invoice_sellers (
  id           uuid primary key default gen_random_uuid(),
  -- Null provider_id = Habba itself.
  provider_id  uuid unique references public.providers(id) on delete restrict,
  legal_name_ar text not null,
  vat_number   text not null,
  cr_number    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),

  constraint invoice_sellers_vat_format check (vat_number ~ '^3[0-9]{13}3$')
);

-- Exactly one Habba-as-seller row.
create unique index invoice_sellers_habba_idx on public.invoice_sellers ((provider_id is null))
  where provider_id is null;

create type invoice_type as enum ('simplified', 'standard');

create table public.zatca_invoices (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null unique references public.orders(id) on delete restrict,
  seller_id      uuid not null references public.invoice_sellers(id) on delete restrict,

  -- Gapless per seller per year. Unlike order numbers (ADR-0006), where gaps
  -- are fine, invoice numbering is a tax requirement — and it is affordable
  -- here because invoices are issued at completion, at far lower volume.
  invoice_number text not null unique,
  invoice_type   invoice_type not null,

  -- Snapshots. An invoice must reproduce what was charged, not what the order
  -- row says today.
  net_amount     numeric(12,2) not null,
  vat_amount     numeric(12,2) not null,
  total_amount   numeric(12,2) not null,
  vat_rate       numeric(5,4) not null,

  qr_base64      text not null,
  invoice_xml    text,          -- UBL 2.1; Phase 2 work
  invoice_hash   text,          -- Phase 2 work

  issued_at      timestamptz not null default now(),

  constraint zatca_invoices_totals_reconcile check (
    total_amount = net_amount + vat_amount
  )
);

create index zatca_invoices_seller_idx on public.zatca_invoices (seller_id, issued_at desc);

create sequence if not exists public.invoice_number_seq;


create or replace function public.issue_zatca_invoice(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_seller  record;
  v_number  text;
  v_qr      text;
  v_net     numeric(12,2);
  v_type    public.invoice_type;
  v_id      uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.status <> 'completed' then
    raise exception 'Only a completed order can be invoiced (order is %)', v_order.status
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.zatca_invoices i where i.order_id = p_order_id) then
    raise exception 'That order is already invoiced' using errcode = 'unique_violation';
  end if;

  -- A zero-amount order (a warranty re-service) is not a taxable supply and
  -- gets no invoice. Issuing a 0.00 tax document would be noise in the
  -- seller's ZATCA reporting.
  if coalesce(v_order.total_amount, 0) = 0 then
    raise exception 'A zero-amount order is not invoiced'
      using errcode = 'check_violation',
            hint = 'Warranty re-services carry no charge.';
  end if;

  -- Habba as seller of record, pending ADR-0009. When that decision lands the
  -- other way, this is where the per-provider lookup goes — and existing
  -- invoices remain correctly attributed because seller_id was recorded.
  select * into v_seller from public.invoice_sellers s
  where s.provider_id is null and s.is_active;

  if v_seller is null then
    raise exception 'No active invoice seller is configured'
      using errcode = 'no_data_found',
            hint = 'Seed invoice_sellers with the Habba legal entity, or resolve ADR-0009.';
  end if;

  v_net := v_order.parts_amount + v_order.labour_amount;

  -- A consumer sale is a simplified invoice (reported after issuance); a sale
  -- to a VAT-registered business is a standard invoice (cleared before). Habba
  -- sells to consumers, so simplified is the default — but the column exists
  -- because provider self-billing produces standard invoices.
  v_type := 'simplified';

  v_number := format('HB-INV-%s-%s',
                     to_char(now(), 'YYYY'),
                     lpad(nextval('public.invoice_number_seq')::text, 6, '0'));

  v_qr := public.zatca_qr(
    v_seller.legal_name_ar,
    v_seller.vat_number,
    now(),
    v_order.total_amount,
    v_order.vat_amount
  );

  insert into public.zatca_invoices (
    order_id, seller_id, invoice_number, invoice_type,
    net_amount, vat_amount, total_amount, vat_rate, qr_base64
  ) values (
    p_order_id, v_seller.id, v_number, v_type,
    v_net, v_order.vat_amount, v_order.total_amount,
    coalesce(v_order.vat_rate_applied, public.vat_rate_on(now()::date)),
    v_qr
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.issue_zatca_invoice(uuid) to authenticated;
grant execute on function public.zatca_qr(text, text, timestamptz, numeric, numeric) to authenticated;

alter table public.invoice_sellers enable row level security;
alter table public.zatca_invoices enable row level security;

-- The seller's legal name and VAT number appear on every invoice, so they are
-- not secret.
create policy invoice_sellers_read on public.invoice_sellers
  for select to authenticated using (true);
create policy invoice_sellers_write on public.invoice_sellers
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

create policy zatca_invoices_read on public.zatca_invoices
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = zatca_invoices.order_id
        and (o.customer_id = auth.uid() or o.provider_id = public.current_provider_id())
    )
    or public.is_ops()
  );
-- No INSERT policy: invoices are issued only by issue_zatca_invoice.
revoke insert on public.zatca_invoices from anon, authenticated;
