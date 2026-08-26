-- 0007 — Plate normalisation in SQL
--
-- This mirrors `normalisePlate` in @habba/core. Both exist deliberately:
-- CLAUDE.md §2.2 says never trust the client, and the plate search key is what
-- matches a car to its own logbook — far too important to accept from an app.
-- The TypeScript version gives instant input feedback; this one is the
-- authority. `supabase/tests/plate_parity.test.ts` asserts the two agree, so
-- they cannot silently drift.
--
-- See ADR-0011 for the letter map, and for why ordering is positional rather
-- than reversed.

create or replace function public.normalise_plate(input text)
returns text
language plpgsql
immutable
strict
parallel safe
as $$
declare
  cleaned  text;
  letters  text;
  digits   text;
begin
  -- Fold digit scripts, unify alef/heh variants, drop tatweel and separators.
  -- Characters in the `from` set beyond the length of `to` are deleted.
  cleaned := upper(
    translate(
      input,
      '٠١٢٣٤٥٦٧٨٩' || '۰۱۲۳۴۵۶۷۸۹' || 'أإآٱ' || 'ةھ' || 'ـ -_.·',
      '0123456789' || '0123456789' || 'اااا' || 'هه'
    )
  );

  -- Arabic plate letters → their official Latin equivalents. Not phonetic:
  -- ص→X, م→Z, ي→V. Do not "correct" this by intuition.
  cleaned := translate(
    cleaned,
    'ابحدرسصطعقكلمنهوي',
    'ABJDRSXTEGKLZNHUV'
  );

  -- Anything left that is not a Latin alphanumeric means an unrecognised
  -- character: reject rather than silently dropping it, or two different cars
  -- could normalise to the same key.
  if cleaned ~ '[^A-Z0-9]' then
    return null;
  end if;

  letters := regexp_replace(cleaned, '[^A-Z]', '', 'g');
  digits  := regexp_replace(cleaned, '[^0-9]', '', 'g');

  -- Only the 17 plate letters are valid. A Latin Q or W survived the mapping
  -- above but is not a plate letter.
  if letters !~ '^[ABJDRSXTEGKLZNHUV]{1,3}$' then
    return null;
  end if;

  -- 1–4 digits. The build prompt says "4 digits"; real plates carry as few as
  -- one, and low-number plates belong to customers worth keeping (ADR-0011).
  if digits !~ '^[0-9]{1,4}$' then
    return null;
  end if;

  return letters || digits;
end;
$$;

comment on function public.normalise_plate(text) is
  'Canonical plate search key (e.g. ABJ1234), or null if unparseable. Mirrors @habba/core normalisePlate.';
