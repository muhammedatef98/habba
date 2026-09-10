-- 0044 — Verification is a fact GoTrue asserts, not a flag nobody sets
--
-- `profiles.phone_verified` has existed since 0005 and `email_verified` since
-- 0039. Both default to false, both are protected from client writes by the
-- column guard (0036/0039/0040) — and **nothing in the entire codebase ever
-- sets either to true.** Grep says so: the only `phone_verified = true` in the
-- repo is inside test fixtures, inserted as the table owner, and 17's own
-- comment admits it "stands in for Supabase Auth's".
--
-- That is not a cosmetic gap. 0037 hardened the ownership-transfer discovery
-- policy to require `phone_verified`, precisely so that setting
-- `profiles.phone` to a victim's number could not reveal their pending
-- transfer. The hardening worked. What nobody noticed is that it closed the
-- door on everyone: with the flag permanently false, **no recipient can ever
-- discover a transfer addressed to them**, and the buyer → owner conversion
-- (§1.3, the zero-CAC acquisition channel) has been dead since 0037 shipped.
--
-- The fix is to connect the flag to the only thing entitled to set it.
--
-- GoTrue records `auth.users.phone_confirmed_at` / `email_confirmed_at` when it
-- has actually delivered a code to that address and seen it typed back. That
-- is what verification means, and it is the one fact in the system a user
-- cannot assert about themselves.

-- ---------------------------------------------------------------------------
-- The rule, in one place
-- ---------------------------------------------------------------------------
-- An identity on a profile is verified when BOTH hold:
--
--   1. GoTrue confirmed that identity on the matching auth.users row, and
--   2. the value on the profile is still THE SAME value GoTrue confirmed.
--
-- (2) is what makes this safe. Without it, a user whose own number is confirmed
-- could set `profiles.phone` to a victim's number and carry the verified flag
-- across with it — which is exactly the escalation 0037 was written to stop.
-- 0039's guard already knocks the flag down whenever the value changes; this
-- only ever raises it again when the new value is one GoTrue vouched for.
create or replace function public.refresh_identity_verification(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth   record;
  v_phone  boolean;
  v_email  boolean;
begin
  select u.phone, u.email, u.phone_confirmed_at, u.email_confirmed_at
    into v_auth
  from auth.users u
  where u.id = p_user_id;

  if not found then
    return;
  end if;

  select
    v_auth.phone_confirmed_at is not null
      and p.phone is not null
      and p.phone = v_auth.phone,
    v_auth.email_confirmed_at is not null
      and p.email is not null
      and lower(p.email) = lower(v_auth.email)
  into v_phone, v_email
  from public.profiles p
  where p.id = p_user_id;

  if not found then
    -- The profile row is written by the app after sign-in, so this is the
    -- ordinary order of events on a first launch rather than an error. The
    -- profiles trigger below catches it a moment later.
    return;
  end if;

  -- Only write when something actually changes. An AFTER trigger on profiles
  -- calls this, so a no-op UPDATE here would re-enter it; comparing first ends
  -- the recursion at depth two instead of relying on a guard flag.
  update public.profiles p
  set phone_verified = coalesce(v_phone, false),
      email_verified = coalesce(v_email, false)
  where p.id = p_user_id
    and (p.phone_verified is distinct from coalesce(v_phone, false)
      or p.email_verified is distinct from coalesce(v_email, false));
end;
$$;

comment on function public.refresh_identity_verification(uuid) is
  'Recomputes profiles.phone_verified/email_verified from what GoTrue confirmed on auth.users. The only writer of either flag (0044).';

-- Never callable by a client: verification is derived, and a user who could
-- ask for their own to be recomputed gains nothing — but a user who could call
-- it for SOMEONE ELSE would be probing auth.users through a side channel.
revoke all on function public.refresh_identity_verification(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger 1: GoTrue confirms an identity
-- ---------------------------------------------------------------------------
create or replace function public.on_auth_user_identity_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The flags are guarded columns (0036/0039), so the recompute has to declare
  -- itself a privileged write exactly like every other server-side path that
  -- writes a fact the user may not assert.
  perform public.begin_privileged_write();
  perform public.refresh_identity_verification(new.id);
  perform public.end_privileged_write();
  return new;
end;
$$;

-- ⚠️ NOT `enable always`, and not by choice.
--
-- `alter table auth.users ...` requires ownership of that table. GoTrue owns it
-- as `supabase_auth_admin`, and migrations run as the project's `postgres`,
-- which is neither the owner nor a member of the owning role — the statement is
-- refused with "must be owner of table users". Creating the trigger is fine:
-- that needs the TRIGGER privilege, which Supabase does grant, and it is the
-- same privilege their own documented `on_auth_user_created` trigger uses.
--
-- What the default (ENABLE ORIGIN) still gives us is everything that matters in
-- practice. GoTrue writes to auth.users as `supabase_auth_admin` in an ordinary
-- session, and the trigger fires for that — role has nothing to do with it.
--
-- What is genuinely given up: a session with
-- `session_replication_role = 'replica'` — a restore, or logical replication
-- apply — would skip it, and the flags could drift from the identities they
-- describe. That setting requires superuser, which nothing in this project has
-- on a hosted database, so the exposure is a platform-side restore rather than
-- anything we can perform or prevent. The recompute is idempotent and derives
-- purely from `auth.users`, so re-running
-- `refresh_identity_verification(user_id)` repairs any row after such an event.
--
-- The profiles trigger below KEEPS `enable always`: we own `public.profiles`,
-- so there the guarantee is available and taken.
drop trigger if exists sync_identity_verification on auth.users;
create trigger sync_identity_verification
  after insert or update of phone, email, phone_confirmed_at, email_confirmed_at
  on auth.users
  for each row execute function public.on_auth_user_identity_changed();

-- ---------------------------------------------------------------------------
-- Trigger 2: the profile appears, or its identity changes
-- ---------------------------------------------------------------------------
-- Two cases the auth.users trigger cannot see:
--
--   * first launch — GoTrue creates and confirms the user, and the app inserts
--     the profile a moment later. Without this the account stays unverified
--     until some unrelated auth.users write happens, which may be never.
--   * a user correcting their own address to one GoTrue has already confirmed
--     (their number came back after a SIM change). 0039's guard sets the flag
--     to false on the way in; this raises it again only if the new value
--     matches what auth.users actually holds.
create or replace function public.on_profile_identity_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.begin_privileged_write();
  perform public.refresh_identity_verification(new.id);
  perform public.end_privileged_write();
  return null;
end;
$$;

drop trigger if exists sync_profile_verification on public.profiles;
create trigger sync_profile_verification
  after insert or update of phone, email
  on public.profiles
  for each row execute function public.on_profile_identity_changed();
alter table public.profiles enable always trigger sync_profile_verification;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Every account that signed in before this migration has a confirmed identity
-- in auth.users and a false flag on its profile. Without this they would stay
-- that way until they happened to change something.
do $$
declare
  v_id uuid;
begin
  perform public.begin_privileged_write();
  for v_id in select p.id from public.profiles p loop
    perform public.refresh_identity_verification(v_id);
  end loop;
  perform public.end_privileged_write();
end $$;
