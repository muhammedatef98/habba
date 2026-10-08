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
  handoverRequired: false,
  features: {
    orderChat: true,
    warrantyClaims: true,
    emergency: true,
    booking: true,
    videoTriage: true,
    ownershipTransfer: true,
    habbaReport: true,
    providerApplications: true,
    guestLogin: true,
    emailLogin: true,
    bookingMobile: true,
    bookingWorkshop: true,
    recordService: true,
    careReminders: true,
    ratings: true,
    mapSearch: true,
    savedPlaces: true,
  },
  minAppVersion: '',
  appStoreUrl: '',
  playStoreUrl: '',
};
