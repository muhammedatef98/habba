-- 0084 — Internal readers, closed to clients
--
-- The setting readers (setting_number/bool/text, 0069) and the named windows
-- and limits built on them were executable by every signed-in user. A client
-- could call setting_text('…') and read any setting, including the ones that
-- are deliberately not public: the OTP send limit and window, the transfer
-- attempt limits, the handover attempt cap — exactly the numbers someone
-- probing those limits would want. has_role / is_provider / is_suspended
-- answered, for any user id, whether that person is an operator, a provider
-- or suspended. commission_rate_for and payments_live told anyone the
-- commission and whether real payments were on.
--
-- Nothing on the client side needs them: no RLS policy, view or invoker
-- function calls them (checked when this was written), the apps never call
-- them, and every server function that does is SECURITY DEFINER and runs as
-- the owner. What the app may know is already served by get_public_settings().
--
-- Suite 48 now fails if any of them is callable by a client again.

do $$
declare
  v_name text;
  v_fn regprocedure;
begin
  foreach v_name in array array[
    'setting_number', 'setting_bool', 'setting_text',
    'auto_complete_window', 'care_default_snooze_days', 'care_lead_days', 'care_lead_km',
    'care_reminder_repeat_days', 'dispatch_max_round', 'dispatch_silence_window',
    'handover_max_attempts', 'location_freshness_limit', 'maintenance_alert_window_days',
    'maintenance_alert_window_km', 'match_radius_for_round', 'ops_stuck_search_after',
    'ops_unconfirmed_after', 'otp_send_limit', 'otp_send_window', 'ownership_transfer_window',
    'route_detour_factor', 'transfer_accept_limit', 'transfer_accept_window',
    'transfer_attempt_limit', 'urban_speed_kmh',
    'has_role', 'is_provider', 'is_suspended', 'commission_rate_for', 'payments_live',
    'feature_on'
  ] loop
    for v_fn in
      select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    loop
      execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    end loop;
  end loop;
end;
$$;
