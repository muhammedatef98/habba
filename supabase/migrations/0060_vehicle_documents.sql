-- 0060 — The papers that go with the car
--
-- الاستمارة, التأمين and الفحص الدوري are the three dates a Saudi driver
-- genuinely cannot afford to miss: driving on an expired one is a fine at the
-- first checkpoint, and an expired فحص دوري blocks renewing the استمارة, so
-- one lapse cascades into the other two.
--
-- They belong in the care section for a reason that goes beyond convenience,
-- and it is the reason this slice includes them at all: they are the only part
-- of القادم the app can state with CERTAINTY. Everything on the maintenance
-- side is inferred from an odometer nobody can see between readings. An expiry
-- date is a date. ADR-0022 makes that distinction the rule that governs every
-- sentence the section writes, and without a certain case on the screen the
-- hedged case reads like vagueness rather than like honesty.
--
-- ---------------------------------------------------------------------------
-- file_path exists and is unused, deliberately
-- ---------------------------------------------------------------------------
-- No upload in this slice: no bucket, no storage policy, no picker. The column
-- is here so that adding one later is a screen and a storage policy, not a
-- migration against a table that by then has rows in every project.
--
-- It is nullable, it is written by nothing, and `vehicle_documents_read` does
-- not treat it specially — when uploads arrive, the bucket gets its own
-- policies the way triage media did in 0048, and this column holds the object
-- path.

create type vehicle_document_type as enum (
  'registration',        -- الاستمارة
  'insurance',           -- التأمين
  'periodic_inspection'  -- الفحص الدوري
);

create table public.vehicle_documents (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  doc_type    vehicle_document_type not null,

  -- A date, not a timestamp. An insurance policy expires on a day, everywhere
  -- it is printed, and storing an instant would invent a time of day that
  -- nobody wrote down and that would then be rendered back to the owner.
  expires_at  date not null,

  -- Supabase Storage object path. Unused in this slice — see the header.
  file_path   text,

  note        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),

  -- One current document of each kind per car. A renewal updates the date; it
  -- does not add a second insurance policy that the sweep would then remind
  -- about twice, once for each expiry.
  constraint vehicle_documents_one_per_type unique (vehicle_id, doc_type)
);

comment on column public.vehicle_documents.file_path is
  'Supabase Storage path. Reserved by 0060 and written by nothing yet — the '
  'column exists so uploads are a screen, not a migration.';

comment on column public.vehicle_documents.expires_at is
  'A date the owner read off a document. Unlike every maintenance due date, '
  'this is CERTAIN and the copy may say so (ADR-0022).';

create index vehicle_documents_expiry_idx
  on public.vehicle_documents (expires_at);

create trigger vehicle_documents_set_updated_at
  before update on public.vehicle_documents
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- RLS — the current owner, and it travels with the car
-- ---------------------------------------------------------------------------
-- Same gate as 0058 and 0059, and it matters more here than anywhere: the
-- استمارة is the document that PROVES ownership, and its expiry date is the
-- first thing a buyer needs and the first thing a seller stops being entitled
-- to. `owns_vehicle()` reads `vehicles.owner_id` as it is now, so the moment a
-- handover completes the buyer sees these rows and the seller does not.
alter table public.vehicle_documents enable row level security;

create policy vehicle_documents_read on public.vehicle_documents
  for select to authenticated
  using (public.owns_vehicle(vehicle_id) or public.is_ops());

-- Every column is the owner's to set, for 0059's reason: this drives their own
-- reminders and nothing else. No money, no dispatch, no provenance, and no
-- line on تقرير هبّة. Classified in supabase/tests/16 as a decision.
create policy vehicle_documents_insert on public.vehicle_documents
  for insert to authenticated with check (public.owns_vehicle(vehicle_id));
create policy vehicle_documents_update on public.vehicle_documents
  for update to authenticated
  using (public.owns_vehicle(vehicle_id)) with check (public.owns_vehicle(vehicle_id));
create policy vehicle_documents_delete on public.vehicle_documents
  for delete to authenticated using (public.owns_vehicle(vehicle_id));


-- ---------------------------------------------------------------------------
-- Document expiry, once
-- ---------------------------------------------------------------------------
-- Split ungated/gated for 0059's reason: the daily sweep has no `auth.uid()`,
-- and a second copy of the arithmetic inside it is how the screen and the
-- notification come to disagree.
--
-- The same lead window as the maintenance side (0059), so the two halves of
-- القادم do not appear on different days for no reason the owner can see.
create type vehicle_document_view as (
  document_id    uuid,
  doc_type       vehicle_document_type,
  expires_at     date,
  days_remaining int,
  is_expired     boolean,
  is_expiring    boolean,
  file_path      text
);

create or replace function public.document_expiry_status(p_vehicle_id uuid)
returns setof public.vehicle_document_view
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    d.doc_type,
    d.expires_at,
    d.expires_at - current_date,
    d.expires_at < current_date,
    d.expires_at - current_date <= public.care_lead_days(),
    d.file_path
  from public.vehicle_documents d
  where d.vehicle_id = p_vehicle_id
  order by d.expires_at;
$$;

revoke all on function public.document_expiry_status(uuid)
  from public, anon, authenticated;


create or replace function public.vehicle_document_status(p_vehicle_id uuid)
returns setof public.vehicle_document_view
language sql
stable
security definer
set search_path = ''
as $$
  -- SECURITY DEFINER reaches past the policies above, so the gate is restated
  -- here and nowhere else decides it.
  select s.*
  from public.document_expiry_status(p_vehicle_id) s
  where public.owns_vehicle(p_vehicle_id) or public.is_ops();
$$;

comment on function public.vehicle_document_status(uuid) is
  'Expiry dates for الاستمارة، التأمين، الفحص الدوري. Certain, unlike the '
  'maintenance side (ADR-0022). Current owner or ops.';

grant execute on function public.vehicle_document_status(uuid) to authenticated;
