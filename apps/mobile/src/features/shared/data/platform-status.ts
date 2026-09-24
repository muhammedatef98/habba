import type { PlatformStatus } from './types.js';

/** What the app assumes when it cannot reach the server's switches: normal service. */
export const DEFAULT_PLATFORM_STATUS: PlatformStatus = {
  ordersPaused: false,
  pausedMessageAr: '',
  announcementAr: '',
  announcementEn: '',
  supportPhone: '',
  supportWhatsapp: '',
  supportEmail: '',
  disputeWindowDays: 14,
  autoCompleteHours: 24,
  suspended: false,
  suspensionReason: null,
};
