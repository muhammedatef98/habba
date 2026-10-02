/**
 * Account and settings.
 *
 * Three grouped sections rather than one column of loose controls: who you
 * are, what you prefer, and what this app is. The previous screen had the
 * right controls in the wrong relationship — a profile card, an amber upsell,
 * two chip rows and a sign-out button, all at the same level, so nothing said
 * which of them were settings and which were actions.
 *
 * Signing out is behind a confirmation, and for a guest the confirmation says
 * something different and true: a guest has no phone and no email, so signing
 * out is not a session ending, it is a logbook becoming unreachable. §11 keeps
 * the logbook ungated on the way in; the honest counterpart is warning them on
 * the way out.
 *
 * Changing the language restarts the app. That is not laziness: RTL is
 * established before the first render (§2.1) and React Native will not flip
 * layout direction on a live tree, so pretending otherwise would leave the app
 * half mirrored.
 */

import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import Constants from 'expo-constants';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, Row, Screen, Text, rowDirectionFor, useTheme } from '@habba/ui';
import type { Locale } from '@habba/i18n';
import { SectionHeader } from '@/features/customer/components/home/SectionHeader';
import { repository } from '@/features/shared/data/repository';
import { formatPhone } from '@/features/shared/lib/format-phone';
import { applyLocale } from '@/features/shared/lib/locale-switch';
import { writeStoredTheme, type ThemePreference } from '@/features/shared/lib/preferences';
import { unregisterThisDevice } from '@/features/shared/lib/push';
import {
  useCanApplyAsProvider,
  useIsApprovedProvider,
  useProviderApplication,
} from '@/features/shared/hooks/use-roles';
import { useMode } from '@/features/shared/state/mode';
import type { ProviderApplicationStatus } from '@/features/shared/data/types';
import { MenuGroup, MenuRow } from '@/features/shared/components/MenuGroup';
import { DeleteAccountCard } from '@/features/shared/components/DeleteAccountCard';
import { useIsAuthenticated, useSession } from '@/features/shared/state/session';

const APPLICATION_STATUS_KEY: Readonly<Record<ProviderApplicationStatus, string>> = {
  none: 'provider.upgrade.statusNone',
  pending: 'provider.upgrade.statusPending',
  in_review: 'provider.upgrade.statusInReview',
  approved: 'provider.upgrade.statusApproved',
  rejected: 'provider.upgrade.statusRejected',
  suspended: 'provider.upgrade.statusSuspended',
};

export default function AccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();

  const locale = useSession((state) => state.locale);
  const setLocale = useSession((state) => state.setLocale);
  const themePreference = useSession((state) => state.themePreference);
  const setThemePreference = useSession((state) => state.setThemePreference);
  const signOut = useSession((state) => state.signOut);
  const isGuest = useSession((state) => state.isGuest);

  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  /**
   * The language the customer has chosen but not yet restarted into.
   *
   * Kept separate from `locale` because `locale` is what the app is currently
   * *rendering* — flipping it early would swap the copy while the layout stays
   * mirrored, which is the one state worse than waiting.
   */
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);

  async function chooseLocale(next: Locale) {
    if (next === locale) {
      setPendingLocale(null);
      return;
    }

    const { needsRestart } = await applyLocale(next, locale);

    if (needsRestart) {
      setPendingLocale(next);
      return;
    }

    // Same-direction change: nothing to wait for, so it is already live.
    setPendingLocale(null);
    setLocale(next);
  }

  const profile = useQuery({ queryKey: ['profile'], queryFn: () => repository.getProfile() });
  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => repository.listVehicles() });
  // Support contacts are set by Habba's operators (0069), not built in: a
  // number that changes should not need an app release.
  const platform = useQuery({
    queryKey: ['platform-status'],
    queryFn: () => repository.getPlatformStatus(),
    staleTime: 60_000,
  });
  const support = platform.data;
  const isProvider = useIsApprovedProvider();
  const canApply = useCanApplyAsProvider();
  const application = useProviderApplication();
  const setMode = useMode((state) => state.setMode);
  const applicationStatus = application.data?.status ?? 'none';
  // A rejected application can be sent again, so it shows the button.
  const hasApplied = applicationStatus !== 'none' && applicationStatus !== 'rejected';
  const hasSupport =
    support !== undefined &&
    (support.supportPhone !== '' || support.supportWhatsapp !== '' || support.supportEmail !== '');

  if (!isAuthenticated) return <Redirect href="/" />;

  const locales: readonly { readonly value: Locale; readonly label: string }[] = [
    { value: 'ar', label: t('settings.arabic') },
    { value: 'en', label: t('settings.english') },
  ];

  const themes: readonly { readonly value: ThemePreference; readonly label: string }[] = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ];

  const person = profile.data ?? null;
  const contact =
    person?.phone !== null && person?.phone !== undefined
      ? formatPhone(person.phone)
      : (person?.email ?? null);

  /**
   * A guest's stored name is a placeholder, not a name.
   *
   * `signInAsGuest` writes the literal string "ضيف", so the English app
   * greeted an English-speaking guest in Arabic — and the existing
   * `?? t('settings.guestLabel')` fallback could never fire, because the field
   * was never null. Translating at the point of display is the fix; the
   * alternative, storing a localised string in the profile, puts UI copy in
   * the database and freezes it at whatever language the account was made in.
   */
  const displayName = isGuest ? t('settings.guestLabel') : (person?.fullName ?? '');
  const initial = (displayName.length > 0 ? displayName : t('settings.guestLabel'))
    .trim()
    .slice(0, 1);

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <Text variant="title">{t('settings.title')}</Text>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t('settings.sectionAccount')} />

        <Card elevation="sm" style={{ gap: theme.spacing.md }}>
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              alignItems: 'center',
              gap: theme.spacing.md,
            }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: theme.radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.primarySubtle,
              }}
            >
              <Text variant="heading" tone="primary">
                {initial}
              </Text>
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {displayName}
              </Text>
              {contact !== null ? (
                <Text variant="bodySmall" tone="muted" numeric numberOfLines={1}>
                  {contact}
                </Text>
              ) : (
                <Text variant="bodySmall" tone="subtle">
                  {t('settings.noContact')}
                </Text>
              )}
            </View>
          </View>

          {isGuest ? (
            <Button
              testID="account-save"
              label={t('auth.guestBannerAction')}
              variant="accent"
              size="medium"
              onPress={() => router.push('/save-account')}
            />
          ) : null}
        </Card>

        <MenuGroup>
          <MenuRow
            testID="account-vehicles"
            icon="home"
            title={t('settings.myVehicles')}
            value={t('settings.vehiclesCount', { count: vehicles.data?.length ?? 0 })}
            onPress={() => router.push('/vehicles')}
          />
          <MenuRow
            testID="account-invoices"
            icon="wallet"
            title={t('settings.myInvoices')}
            onPress={() => router.push('/invoices')}
          />
        </MenuGroup>

        {/* The way into the provider side, on the tab everyone already
            visits. It used to live on a separate profile screen that nothing
            linked to, so a technician had no way in at all. §5.1.4: the
            switch renders only for a role the SERVER granted; a customer
            sees the invitation to apply instead, or where their application
            stands, and neither once operators close applications. */}
        {isProvider ? (
          <MenuGroup testID="mode-switcher">
            <MenuRow
              testID="switch-to-provider"
              icon="wrench"
              title={t('profile.switchToProvider')}
              subtitle={t('profile.modeBody')}
              onPress={() => {
                setMode('provider');
                router.replace('/shift');
              }}
            />
          </MenuGroup>
        ) : canApply ? (
          <Card
            testID="provider-upgrade"
            elevation="none"
            style={{
              gap: theme.spacing.sm,
              backgroundColor: theme.colors.primarySubtle,
              borderColor: theme.colors.border,
              borderWidth: 1,
            }}
          >
            <Row gap="md">
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.surface,
                }}
              >
                <Icon name="wrench" size={theme.iconSize.sm} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{t('provider.upgrade.cardTitle')}</Text>
                <Text variant="caption" tone="muted">
                  {hasApplied
                    ? t(APPLICATION_STATUS_KEY[applicationStatus])
                    : t('provider.upgrade.cardBody')}
                </Text>
              </View>
            </Row>
            {hasApplied ? null : (
              <Button
                testID="become-provider"
                label={t('provider.upgrade.cta')}
                variant="accent"
                size="medium"
                onPress={() => router.push('/become-provider')}
              />
            )}
          </Card>
        ) : null}
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t('settings.sectionPreferences')} />

        <Card
          elevation="none"
          style={{ gap: theme.spacing.base, borderColor: theme.colors.border, borderWidth: 1 }}
        >
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" tone="muted">
              {t('settings.language')}
            </Text>
            <SegmentedRow
              options={locales.map((option) => ({ key: option.value, label: option.label }))}
              selected={pendingLocale ?? locale}
              onSelect={(value) => void chooseLocale(value as Locale)}
              testIdPrefix="locale"
            />

            {/* The old caption said the app would restart. It never did, and
                nothing applied the choice either. Now the choice is saved and
                staged, and this says exactly what is true: it takes effect the
                next time the app is opened. */}
            {pendingLocale !== null ? (
              <Card
                testID="locale-restart-notice"
                elevation="none"
                style={{
                  flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                  gap: theme.spacing.sm,
                  backgroundColor: theme.colors.accentSubtle,
                  borderColor: theme.colors.accent,
                  borderWidth: 1,
                }}
              >
                <Icon name="alert" size={theme.iconSize.sm} color={theme.colors.accentFg} />
                <Text variant="caption" tone="accent" style={{ flex: 1 }}>
                  {t('settings.restartRequired')}
                </Text>
              </Card>
            ) : (
              <Text variant="caption" tone="subtle">
                {t('settings.languageHint')}
              </Text>
            )}
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" tone="muted">
              {t('settings.theme')}
            </Text>
            <SegmentedRow
              options={themes.map((option) => ({ key: option.value, label: option.label }))}
              selected={themePreference}
              onSelect={(value) => {
                const next = value as ThemePreference;
                setThemePreference(next);
                // No restart: a theme is a render-time choice, unlike direction.
                void writeStoredTheme(next);
              }}
              testIdPrefix="theme"
            />
          </View>
        </Card>
      </View>

      {hasSupport ? (
        <View testID="support-section" style={{ gap: theme.spacing.md }}>
          <SectionHeader title={t('settings.sectionSupport')} />
          <MenuGroup>
            {support.supportPhone !== '' ? (
              <MenuRow
                icon="phone"
                title={t('settings.supportCall')}
                value={support.supportPhone}
                onPress={() => void Linking.openURL(`tel:${support.supportPhone}`)}
              />
            ) : null}
            {support.supportWhatsapp !== '' ? (
              <MenuRow
                icon="chat"
                title={t('settings.supportWhatsapp')}
                value={support.supportWhatsapp}
                onPress={() =>
                  void Linking.openURL(
                    `https://wa.me/${support.supportWhatsapp.replace(/[^0-9]/g, '')}`,
                  )
                }
              />
            ) : null}
            {support.supportEmail !== '' ? (
              <MenuRow
                icon="chat"
                title={t('settings.supportEmail')}
                value={support.supportEmail}
                onPress={() => void Linking.openURL(`mailto:${support.supportEmail}`)}
              />
            ) : null}
          </MenuGroup>
        </View>
      ) : null}

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t('settings.sectionAbout')} />

        {/* The documents in force (0083), and the provider terms for anyone
            who works with Habba. */}
        <MenuGroup testID="legal-section">
          <MenuRow
            testID="legal-terms-row"
            icon="inspection"
            title={t('legal.terms')}
            onPress={() => router.push({ pathname: '/legal', params: { kind: 'terms' } })}
          />
          <MenuRow
            testID="legal-privacy-row"
            icon="lockout"
            title={t('legal.privacy')}
            onPress={() => router.push({ pathname: '/legal', params: { kind: 'privacy' } })}
          />
          {isProvider ? (
            <MenuRow
              testID="legal-provider-terms-row"
              icon="wrench"
              title={t('legal.providerTerms')}
              onPress={() =>
                router.push({ pathname: '/legal', params: { kind: 'provider_terms' } })
              }
            />
          ) : null}
        </MenuGroup>

        <Card elevation="none" style={{ borderColor: theme.colors.border, borderWidth: 1 }}>
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              alignItems: 'center',
              gap: theme.spacing.md,
            }}
          >
            <Text variant="bodySmall" tone="muted" style={{ flex: 1 }}>
              {t('settings.version')}
            </Text>
            <Text variant="bodySmall" tone="subtle" numeric>
              {/* The real bundle version, not a hardcoded string that goes
                  stale the first time it ships without being edited. */}
              {Constants.expoConfig?.version ?? '—'}
            </Text>
          </View>
        </Card>
      </View>

      {confirmingSignOut ? (
        <Card
          testID="sign-out-confirm"
          elevation="sm"
          style={{
            gap: theme.spacing.md,
            backgroundColor: theme.colors.emergencySubtle,
            borderColor: theme.colors.emergencyBorder,
            borderWidth: 1,
          }}
        >
          <Text variant="bodyStrong" tone="emergency">
            {t('settings.signOutConfirmTitle')}
          </Text>
          <Text variant="bodySmall" tone="muted">
            {/* A guest signing out is not a session ending — it is a logbook
                becoming unreachable, because there is no phone or email to come
                back with. Saying the same thing to both would be a lie to one. */}
            {isGuest ? t('settings.signOutGuestWarning') : t('settings.signOutConfirmBody')}
          </Text>
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              gap: theme.spacing.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <Button
                testID="sign-out-cancel"
                label={t('common.cancel')}
                variant="secondary"
                size="medium"
                onPress={() => setConfirmingSignOut(false)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                testID="sign-out-do"
                label={t('settings.signOutConfirm')}
                variant="emergency"
                size="medium"
                onPress={async () => {
                  // Before the session ends: only a signed-in person can take
                  // their own phone off the list.
                  await unregisterThisDevice();
                  signOut();
                  router.replace('/');
                }}
              />
            </View>
          </View>
        </Card>
      ) : (
        <Button
          testID="account-sign-out"
          label={t('settings.signOut')}
          variant="ghost"
          onPress={() => setConfirmingSignOut(true)}
        />
      )}

      <DeleteAccountCard />
    </Screen>
  );
}

/**
 * A row of mutually exclusive choices.
 *
 * `radio` rather than `button` so a screen reader announces it as a choice
 * within a set, which is what it is — the old chips said "button" and gave no
 * indication that picking one unpicked another.
 */
function SegmentedRow({
  options,
  selected,
  onSelect,
  testIdPrefix,
}: {
  readonly options: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly selected: string;
  readonly onSelect: (key: string) => void;
  readonly testIdPrefix: string;
}) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
        gap: 4,
        padding: 4,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surfaceSunken,
      }}
    >
      {options.map((option) => {
        const isSelected = option.key === selected;
        return (
          <Pressable
            key={option.key}
            testID={`${testIdPrefix}-${option.key}`}
            onPress={() => onSelect(option.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [
              {
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 40,
                paddingVertical: theme.spacing.sm,
                paddingHorizontal: theme.spacing.sm,
                borderRadius: theme.radius.sm,
                backgroundColor: isSelected ? theme.colors.surface : 'transparent',
              },
              isSelected ? { shadowColor: '#000', ...theme.elevation.sm } : null,
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <Text variant="bodySmall" tone={isSelected ? 'primary' : 'muted'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
