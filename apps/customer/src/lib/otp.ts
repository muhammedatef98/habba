/**
 * The app's OTP provider instance.
 *
 * Swapping the development stub for a real SMS provider (Unifonic, Taqnyat,
 * Twilio — open decision, see otp-provider.ts) happens here and nowhere else.
 */

import { DevOtpProvider, type OtpProvider } from './otp-provider.js';

export const otpProvider: OtpProvider = new DevOtpProvider();
