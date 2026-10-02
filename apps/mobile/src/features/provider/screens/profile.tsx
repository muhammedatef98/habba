/**
 * ملفي — the technician as customers and Habba see them.
 *
 * The business card at the top (name, trade, city, approved, Nafath), the
 * record under it (jobs done, rating, acceptance), then what customers have
 * actually said — the distribution as well as the average, because 4.6 from
 * five reviews and 4.6 from two hundred are different reputations.
 *
 * And the way back to being a customer (§5.1.4): a technician owns a car
 * too, and their logbook is one row away.
 */

import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, Icon, Row, Screen, Text, rowDirectionFor, useTheme } from '@habba/ui';
import {
  InitialBadge,
  PRO_HERO,
  SectionTitle,
  Stars,
  StatTile,
} from '@/features/provider/components/ProParts';
import { useProviderDashboard } from '@/features/provider/hooks/use-dashboard';
import { MenuGroup, MenuRow } from '@/features/shared/components/MenuGroup';
import { repository } from '@/features/shared/data/repository';
import { formatGregorianDate } from '@/features/shared/lib/dates';
import { formatShortDate } from '@/features/shared/lib/format-number';
import { useMode } from '@/features/shared/state/mode';

const STAR_KEYS = ['5', '4', '3', '2', '1'] as const;

export default function ProviderProfileScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dashboard = useProviderDashboard();
  const setMode = useMode((state) => state.setMode);
  const platform = useQuery({
    queryKey: ['platform-status'],
    queryFn: () => repository.getPlatformStatus(),
    staleTime: 60_000,
  });

  const data = dashboard.data;
  const profile = data?.profile;
  const language = i18n.language;
  const isArabic = language.startsWith('ar');
  const name =
    profile === undefined
      ? ''
      : isArabic
        ? profile.businessNameAr
        : (profile.businessNameEn ?? profile.businessNameAr);
  const totalReviews =
    data === undefined ? 0 : STAR_KEYS.reduce((sum, key) => sum + data.stars[key], 0);
  const support = platform.data;

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }} testID="provider-profile">
      {/* The business card. */}
      <View
        style={{
          borderRadius: theme.radius.xl,
          padding: theme.spacing.lg,
          gap: theme.spacing.base,
          backgroundColor: PRO_HERO,
        }}
      >
        <Row gap="md">
          <InitialBadge name={name} size={60} inverse />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" numberOfLines={2} style={{ color: '#FFFFFF' }}>
              {name.length > 0 ? name : '—'}
            </Text>
            {profile !== undefined ? (
              <Text variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {profile.providerType === 'workshop'
                  ? t('pro.typeWorkshop')
                  : t('pro.typeIndividual')}
                {' · '}
                {isArabic ? profile.cityNameAr : profile.cityNameEn}
              </Text>
            ) : null}
          </View>
        </Row>

        <Row gap="xs" wrap>
          <HeroBadge icon="check" label={t('pro.approved')} />
          {profile?.nafathVerified === true ? (
            <HeroBadge icon="lockout" label={t('pro.verified')} />
          ) : null}
        </Row>

        {profile !== undefined ? (
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.65)' }}>
            {t('pro.memberSince', {
              date: formatGregorianDate(profile.memberSince, language),
            })}
          </Text>
        ) : null}
      </View>

      {/* The record. */}
      <Row gap="sm" align="stretch">
        <StatTile
          testID="pro-stat-jobs"
          icon="wrench"
          value={profile === undefined ? '—' : String(profile.jobsCompleted)}
          label={t('pro.statsJobs')}
        />
        <StatTile
          testID="pro-stat-rating"
          icon="star"
          tone="accent"
          value={
            profile === undefined || profile.ratingCount === 0
              ? t('pro.noRating')
              : profile.ratingAvg.toFixed(1)
          }
          label={t('pro.statsRating')}
        />
        <StatTile
          testID="pro-stat-acceptance"
          icon="check"
          value={
            profile === undefined || profile.acceptanceRate === null
              ? '—'
              : `${Math.round(profile.acceptanceRate)}%`
          }
          label={t('pro.statsAcceptance')}
        />
      </Row>

      {/* What customers say. */}
      <View style={{ gap: theme.spacing.md }}>
        <SectionTitle
          title={t('pro.reviewsTitle')}
          trailing={
            profile === undefined
              ? undefined
              : t('pro.ratingsCount', { count: profile.ratingCount })
          }
        />

        {data !== undefined && totalReviews > 0 && profile !== undefined ? (
          <Card
            testID="pro-rating-breakdown"
            elevation="none"
            style={{ borderWidth: 1, borderColor: theme.colors.border }}
          >
            <Row gap="lg" align="center">
              <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                <Text variant="display" numeric>
                  {profile.ratingAvg.toFixed(1)}
                </Text>
                <Stars value={profile.ratingAvg} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                {STAR_KEYS.map((key) => {
                  const count = data.stars[key];
                  const share = totalReviews === 0 ? 0 : count / totalReviews;
                  return (
                    <Row key={key} gap="sm">
                      <Text variant="caption" tone="muted" numeric style={{ width: 10 }}>
                        {key}
                      </Text>
                      <View
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.surfaceSunken,
                          overflow: 'hidden',
                          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                        }}
                      >
                        <View
                          style={{
                            width: `${Math.round(share * 100)}%`,
                            backgroundColor: theme.colors.accent,
                            borderRadius: theme.radius.full,
                          }}
                        />
                      </View>
                      <Text variant="caption" tone="subtle" numeric style={{ width: 22 }}>
                        {count}
                      </Text>
                    </Row>
                  );
                })}
              </View>
            </Row>
          </Card>
        ) : null}

        {data === undefined || data.reviews.length === 0 ? (
          <Text variant="bodySmall" tone="muted">
            {t('pro.noReviews')}
          </Text>
        ) : (
          data.reviews.map((review, index) => (
            <Card
              key={`${review.createdAt}-${index}`}
              testID={`review-${index}`}
              elevation="none"
              style={{ gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border }}
            >
              <Row gap="sm" justify="space-between">
                <Stars value={review.stars} size={13} />
                <Text variant="caption" tone="subtle" numeric>
                  {formatShortDate(review.createdAt, language)}
                </Text>
              </Row>
              {review.comment !== null && review.comment.trim().length > 0 ? (
                <Text variant="bodySmall">{review.comment}</Text>
              ) : null}
              {review.tags.length > 0 ? (
                <Row gap="xs" wrap>
                  {review.tags.map((tag) => (
                    <View
                      key={tag}
                      style={{
                        paddingHorizontal: theme.spacing.sm,
                        paddingVertical: 2,
                        borderRadius: theme.radius.full,
                        backgroundColor: theme.colors.primarySubtle,
                      }}
                    >
                      <Text variant="caption" tone="primary">
                        {tag}
                      </Text>
                    </View>
                  ))}
                </Row>
              ) : null}
            </Card>
          ))
        )}
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionTitle title={t('pro.sectionAccount')} />
        <MenuGroup>
          <MenuRow
            testID="switch-to-customer"
            icon="home"
            title={t('profile.switchToCustomer')}
            subtitle={t('pro.switchToCustomerHint')}
            onPress={() => {
              setMode('customer');
              router.replace('/vehicles');
            }}
          />
          <MenuRow
            testID="pro-provider-terms"
            icon="inspection"
            title={t('legal.providerTerms')}
            subtitle={t('pro.providerTermsHint')}
            onPress={() => router.push({ pathname: '/legal', params: { kind: 'provider_terms' } })}
          />
          {support !== undefined && support.supportWhatsapp !== '' ? (
            <MenuRow
              icon="chat"
              title={t('pro.supportTitle')}
              value={support.supportWhatsapp}
              onPress={() =>
                void Linking.openURL(
                  `https://wa.me/${support.supportWhatsapp.replace(/[^0-9]/g, '')}`,
                )
              }
            />
          ) : support !== undefined && support.supportPhone !== '' ? (
            <MenuRow
              icon="phone"
              title={t('pro.supportTitle')}
              value={support.supportPhone}
              onPress={() => void Linking.openURL(`tel:${support.supportPhone}`)}
            />
          ) : null}
        </MenuGroup>
      </View>
    </Screen>
  );
}

function HeroBadge({
  icon,
  label,
}: {
  readonly icon: 'check' | 'lockout';
  readonly label: string;
}) {
  const theme = useTheme();
  return (
    <Row
      gap="xs"
      style={{
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 4,
        borderRadius: theme.radius.full,
        backgroundColor: 'rgba(255,255,255,0.14)',
      }}
    >
      <Icon name={icon} size={12} color={theme.colors.accent} />
      <Text variant="caption" style={{ color: '#FFFFFF' }}>
        {label}
      </Text>
    </Row>
  );
}
