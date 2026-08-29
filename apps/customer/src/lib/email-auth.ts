/**
 * The app's email auth provider instance.
 *
 * Swapping the development stub for real Supabase Auth email sign-in (open
 * decision, see email-auth-provider.ts) happens here and nowhere else.
 */

import { DevEmailAuthProvider, type EmailAuthProvider } from './email-auth-provider.js';

export const emailAuthProvider: EmailAuthProvider = new DevEmailAuthProvider();
