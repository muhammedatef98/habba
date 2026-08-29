-- 0039 — Guest access and email identity
--
-- Two new ways in, neither of which the Phase 1 schema allowed:
--
--   * GUEST. §11 says the logbook is top-of-funnel and must never be gated.
--     Today it is gated — behind a phone number and an SMS round-trip, before
--     the user has seen anything. A guest should be able to add a car and see
--     the logbook fill up, then be asked for an identity when it actually buys
--     them something (an order, a report, a transfer).
--
--   * EMAIL. §9.1 specifies phone OTP, and phone stays the primary and default
--     path for the Saudi market. Email is a secondary route, not a replacement.
--
-- ⚠️ The architectural decision that makes both work: a guest is a real
-- Supabase ANONYMOUS auth user, not an unauthenticated client. It matters
-- because every RLS policy in this schema is keyed on `auth.uid()`. A guest
-- with no uid would match no rows anywhere, so a guest logbook could not
-- exist — and the whole point is that it can. Anonymous auth issues a genuine
-- uid, so:
--
--   * every policy written in 0013/0022/0037 keeps working, unchanged;
--   * the guest's vehicles and timeline are real rows they own;
--   * linking a phone or email later keeps the SAME uid, so the logbook — the
--     moat — survives the upgrade instead of being stranded.
--
-- The schema changes below are what that requires: `phone` was the login
-- identity and therefore NOT NULL, which a guest and an email-only user both
-- fail.

-- ---------------------------------------------------------------------------
-- profiles.phone becomes optional
-- ---------------------------------------------------------------------------
alter table public.profiles alter column phone drop not null;

-- The E.164 rule still applies to any phone that IS present — dropping NOT
-- NULL must not become a way to store a malformed number.
alter table public.profiles drop constraint profiles_phone_e164;
alter table public.profiles add constraint profiles_phone_e164 check (
  phone is null or phone ~ '^\+9665[0-9]{8}$'
);

-- `unique` already permits multiple NULLs in Postgres, so many guests coexist
-- without colliding while two spellings of one real number still cannot
-- (ADR-0011).

-- ---------------------------------------------------------------------------
-- Email as a real login identity
-- ---------------------------------------------------------------------------
-- The column existed since 0005 but was decorative: no uniqueness, no
-- verification state. As a login identity it needs both, for the same reason
-- phone has both.
alter table public.profiles add column email_verified boolean not null default false;

-- Case-insensitive: Ahmed@example.com and ahmed@example.com are one person,
-- and letting them become two accounts is the email equivalent of the
-- unnormalised-phone bug ADR-0011 exists to prevent.
create unique index profiles_email_lower_idx on public.profiles (lower(email))
  where email is not null;

alter table public.profiles add constraint profiles_email_shape check (
  email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
);

-- ---------------------------------------------------------------------------
-- Guest state
-- ---------------------------------------------------------------------------
alter table public.profiles add column is_guest boolean not null default false;

-- A profile must be reachable somehow: a guest by virtue of being a guest, and
-- anyone else by at least one verified-capable identity. This is what stops a
-- non-guest profile existing with no way to ever sign in again.
alter table public.profiles add constraint profiles_has_identity check (
  is_guest or phone is not null or email is not null
);

-- full_name is asked for during phone onboarding, but a guest has not been
-- asked anything yet. Defaulting keeps the NOT NULL contract that the rest of
-- the app relies on rather than making every caller null-check a name.
alter table public.profiles alter column full_name set default 'ضيف';

comment on column public.profiles.is_guest is
  'True while the user has claimed no phone or email. Same uid before and after conversion — the logbook carries over (0039).';
comment on column public.profiles.phone is
  'E.164 (+9665XXXXXXXX). Primary login identity; null for guests and email-only users. Normalise with @habba/core before writing.';


-- ---------------------------------------------------------------------------
-- The column guard has to learn about the new columns
-- ---------------------------------------------------------------------------
-- 0036 established that `role` and `phone_verified` are not self-settable, and
-- that changing a phone revokes its verification. Email needs exactly the same
-- treatment, and `is_guest` needs a rule of its own — otherwise "am I a guest"
-- becomes a claim rather than a fact.
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Still deliberately does NOT exempt is_ops() — see 0036. A user who set
  -- their own role to 'ops' would otherwise pass this guard.
  if public.is_privileged_write() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'Profile identity cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  if new.role is distinct from old.role then
    raise exception 'Your role is set by Habba, not by you'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verification is a fact about a message that was received, not a claim.
  if new.phone_verified is distinct from old.phone_verified then
    raise exception 'Phone verification cannot be set directly'
      using errcode = 'insufficient_privilege',
            hint = 'Verify the number by SMS.';
  end if;

  if new.email_verified is distinct from old.email_verified then
    raise exception 'Email verification cannot be set directly'
      using errcode = 'insufficient_privilege',
            hint = 'Verify the address by email.';
  end if;

  -- Changing an identity revokes its verification, so a verified flag cannot
  -- be carried onto a different number or address.
  if new.phone is distinct from old.phone then
    new.phone_verified := false;
  end if;

  if new.email is distinct from old.email then
    new.email_verified := false;
  end if;

  -- Guest status is derived from having an identity, never asserted. It may
  -- only fall — claiming a phone or email — and only when one is actually
  -- present. Letting it rise again would hand a real account the weaker
  -- guest rules; letting it fall without an identity would strand the
  -- profile with no way back in, which profiles_has_identity also refuses.
  if new.is_guest and not old.is_guest then
    raise exception 'An account cannot be turned back into a guest'
      using errcode = 'insufficient_privilege';
  end if;

  if old.is_guest and not new.is_guest
     and new.phone is null and new.email is null then
    raise exception 'Add a phone number or an email address to keep this account'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
