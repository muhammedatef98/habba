/**
 * The app's email OTP provider instance.
 *
 * Real email auth when the app is pointed at a Supabase project, the dev stub
 * otherwise — the same switch `otp.ts` makes for phone, in the same one place.
 */

import {
  DevEmailOtpProvider,
  SupabaseEmailOtpProvider,
  type EmailOtpProvider,
} from './email-otp-provider.js';
import { getSupabaseClient } from './supabase.js';

function createEmailOtpProvider(): EmailOtpProvider {
  const client = getSupabaseClient();
  return client === null ? new DevEmailOtpProvider() : new SupabaseEmailOtpProvider(client);
}

export const emailOtpProvider: EmailOtpProvider = createEmailOtpProvider();
