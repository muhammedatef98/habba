/**
 * What Habba's operators have said to everyone, and to this account.
 *
 * Three things, in order of how much they change what the person can do:
 * their account is suspended (0069), new orders are paused, or there is an
 * announcement. Only the first that applies is shown — a stack of banners is
 * read as noise.
 *
 * The server enforces each of these on its own (a suspended account's order
 * is refused on the row; a paused platform refuses to send an order out).
 * This banner is the explanation, so the refusal is never a surprise.
 *
 * Like OfflineNotice it sits above the navigator and carries its own top
 * inset — unless the offline notice is already showing above it and has
 * taken the inset.
 */

import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNetworkState } from 'expo-network';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Row, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useSession } from '@/features/shared/state/session';

export function PlatformNotice() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const locale = useSession((state) => state.locale);
  const status = useQuery({
    queryKey: ['platform-status'],
    queryFn: () => repository.getPlatformStatus(),
    staleTime: 60_000,
    // An operator pausing orders should reach an open app within minutes,
    // not at its next cold start.
    refetchInterval: 5 * 60_000,
  });

  const data = status.data;
  if (data === undefined) return null;

  const offline = network.isInternetReachable === false || network.isConnected === false;
  const announcement = (
    locale === 'en' && data.announcementEn !== '' ? data.announcementEn : data.announcementAr
  ).trim();

  const notice = data.suspended
    ? {
        tone: 'warning' as const,
        background: theme.colors.warningSubtle,
        border: theme.colors.warningBorder,
        title: t('platform.suspendedTitle'),
        body:
          data.suspensionReason !== null && data.suspensionReason !== ''
            ? t('platform.suspendedBody', { reason: data.suspensionReason })
            : t('platform.suspendedNoReason'),
      }
    : data.ordersPaused
      ? {
          tone: 'warning' as const,
          background: theme.colors.warningSubtle,
          border: theme.colors.warningBorder,
          title: t('platform.pausedTitle'),
          body: data.pausedMessageAr,
        }
      : announcement !== ''
        ? {
            tone: 'info' as const,
            background: theme.colors.infoSubtle,
            border: theme.colors.border,
            title: t('platform.announcementTitle'),
            body: announcement,
          }
        : null;

  if (notice === null) return null;

  return (
    <View
      testID="platform-notice"
      accessibilityRole={data.suspended || data.ordersPaused ? 'alert' : 'summary'}
      style={{
        paddingTop: (offline ? 0 : insets.top) + theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
        paddingHorizontal: theme.spacing.base,
        backgroundColor: notice.background,
        borderBottomWidth: 1,
        borderBottomColor: notice.border,
      }}
    >
      <Row gap="sm" align="flex-start">
        <Icon
          name={notice.tone === 'info' ? 'bell' : 'alert'}
          size={theme.iconSize.sm}
          color={notice.tone === 'info' ? theme.colors.infoFg : theme.colors.warningFg}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            variant="caption"
            tone={notice.tone}
            style={{ fontWeight: theme.fontWeight.semibold }}
          >
            {notice.title}
          </Text>
          {notice.body !== '' ? (
            <Text variant="caption" tone="muted">
              {notice.body}
            </Text>
          ) : null}
        </View>
      </Row>
    </View>
  );
}
