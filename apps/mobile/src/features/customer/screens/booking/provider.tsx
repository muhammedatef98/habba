/**
 * Step 2 — who does it.
 *
 * The emergency flow deliberately does not let anyone choose: at the roadside
 * the right provider is the nearest available one, and a menu is a delay.
 * Booking ahead is the opposite — the whole reason to book instead of calling
 * is that you get to pick — so this shows what a person actually chooses on:
 * rating, how much work they have done, where they are, and what they charge.
 *
 * Rating and job count are real columns (0018) and are shown as they are.
 * There is no "recommended" badge and no sorting by anything the customer
 * cannot see, because a ranking they cannot audit is a ranking they cannot
 * trust — and trust is the product.
 */

import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Icon,
  Screen,
  SkeletonCard,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import { BookingSteps } from '@/features/customer/components/booking/BookingSteps';
import { repository } from '@/features/shared/data/repository';
import { formatCount } from '@/features/shared/lib/format-number';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { useBookingDraft } from '@/features/shared/state/booking-draft';
import type { BookingProvider } from '@/features/shared/data/types';

export default function BookingProviderScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const draft = useBookingDraft();
  const service = draft.service;
  const mode = draft.mode;

  const isArabic = i18n.language.startsWith('ar');
  // Arabic name unless there is an English one, which many workshops do not
  // have — a transliteration invented here would be worse than the real name.
  const nameOf = (provider: BookingProvider) =>
    isArabic ? provider.businessNameAr : (provider.businessNameEn ?? provider.businessNameAr);

  const providers = useQuery({
    queryKey: ['booking-providers', service?.id, mode],
    queryFn: () => repository.listBookingProviders(service?.id ?? '', mode ?? 'workshop'),
    enabled: service !== null && mode !== null,
  });

  // Deep-linked or resumed with an empty draft: step 1 is the only place the
  // answers exist, so go there rather than render a screen about nothing.
  if (service === null || mode === null) return <Redirect href="/booking" />;

  const rows = providers.data ?? [];

  return (
    <Screen scrollable>
      <BookingSteps
        current={1}
        title={t('booking.providerHeadline')}
        subtitle={t('booking.providerSubhead')}
      />

      {providers.isPending ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('common.loading')}
          style={{ gap: theme.spacing.md }}
        >
          <SkeletonCard testID="providers-skeleton" />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : rows.length === 0 ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <Text variant="body" tone="muted">
            {t('booking.providerNone')}
          </Text>
        </Card>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {rows.map((provider) => {
            const selected = draft.provider?.id === provider.id;

            return (
              <Card
                key={provider.id}
                testID={`booking-provider-${provider.id}`}
                elevation={selected ? 'sm' : 'none'}
                onPress={() => {
                  draft.selectProvider(provider);
                  router.push('/booking/slot');
                }}
                accessibilityLabel={nameOf(provider)}
                style={{
                  gap: theme.spacing.md,
                  backgroundColor: theme.colors.surface,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  borderWidth: selected ? 1.5 : 1,
                }}
              >
                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'flex-start',
                    gap: theme.spacing.md,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: theme.radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.colors.primarySubtle,
                    }}
                  >
                    <Text variant="bodyStrong" tone="primary">
                      {nameOf(provider).trim().slice(0, 1)}
                    </Text>
                  </View>

                  <View style={{ flex: 1, gap: theme.spacing.xs }}>
                    <Text variant="bodyStrong" numberOfLines={2}>
                      {nameOf(provider)}
                    </Text>

                    <View
                      style={{
                        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                        alignItems: 'center',
                        gap: theme.spacing.sm,
                        flexWrap: 'wrap',
                      }}
                    >
                      {/* A star and a number, not a five-star widget:
                          `RatingStars` is the input the customer rates a
                          finished job with, and reusing it here would put a
                          tappable control where a fact belongs. */}
                      <Icon name="star" size={14} color={theme.colors.accent} />
                      <Text variant="caption" tone="muted" numeric>
                        {provider.ratingAvg.toFixed(1)}
                      </Text>
                      <Text variant="caption" tone="subtle">
                        {/* `jobs`, not `count`: i18next reserves `count` for
                            plural selection and expects a number, and this is
                            an already-formatted string — Latin digits in an
                            Arabic UI (§8). */}
                        {t('booking.providerJobs', {
                          jobs: formatCount(provider.jobsCompleted, i18n.language),
                        })}
                      </Text>
                    </View>
                  </View>

                  <Text variant="bodyStrong" tone="accent" numeric>
                    {t('common.sar', { amount: formatSarDisplay(provider.price) })}
                  </Text>
                </View>

                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                    paddingTop: theme.spacing.md,
                  }}
                >
                  <Icon
                    name={provider.addressAr === null ? 'locate' : 'home'}
                    size={theme.iconSize.sm}
                    color={theme.colors.textMuted}
                  />
                  <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={2}>
                    {provider.addressAr ?? t('booking.providerComesToYou')}
                  </Text>
                  <Icon
                    name="chevronForward"
                    size={theme.iconSize.sm}
                    color={theme.colors.textSubtle}
                  />
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <Button
        testID="booking-provider-back"
        label={t('common.back')}
        variant="ghost"
        onPress={() => router.back()}
      />
    </Screen>
  );
}
