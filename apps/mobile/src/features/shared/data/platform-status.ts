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
  // On until the server says otherwise: a switch that cannot be read (offline,
  // a first launch) must not hide the emergency button. The server refuses a
  // switched-off request regardless (0081).
  features: {
    emergency: true,
    booking: true,
    videoTriage: true,
    ownershipTransfer: true,
    habbaReport: true,
    providerApplications: true,
    guestLogin: true,
    emailLogin: true,
  },
  minAppVersion: '',
  appStoreUrl: '',
  playStoreUrl: '',
  termsUrl: '',
  privacyUrl: '',
};
