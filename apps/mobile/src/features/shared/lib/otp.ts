/**
 * The app's OTP provider instance.
 *
 * Real phone auth when the app is pointed at a Supabase project, the dev stub
 * otherwise — the same switch the repository uses, for the same reason: the
 * app has to run end-to-end on a laptop with no project and no SMS credit.
 *
 * This is the only place that decision is made.
 */

import { getSupabaseClient } from './supabase.js';
import { DevOtpProvider, SupabaseOtpProvider, type OtpProvider } from './otp-provider.js';

function createOtpProvider(): OtpProvider {
  const client = getSupabaseClient();
  return client === null ? new DevOtpProvider() : new SupabaseOtpProvider(client);
}

export const otpProvider: OtpProvider = createOtpProvider();
