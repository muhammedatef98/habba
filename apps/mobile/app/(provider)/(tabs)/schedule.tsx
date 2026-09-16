// Route file. The screen lives in @/features/provider/screens/schedule.
//
// A workshop's tab, not every provider's: the tab bar hides it from a mobile
// technician (see (tabs)/_layout.tsx), who has no bays to publish. That is a
// rendering decision — `generate_slots` and the write policy on
// `appointment_slots` are both scoped to `current_provider_id()` server-side
// (§5.1.3), so reaching this route by hand fills nobody else's calendar.
export { default } from '@/features/provider/screens/schedule';
