/**
 * «سجلّ مختوم» — the seal on the logbook (0108).
 *
 * Every entry is hash-chained to the one before it (0009/0010), so an edited
 * or deleted row breaks the chain. That was true from the first migration and
 * nobody could see it: only the Habba report ever asked. This strip asks the
 * server to walk the chain and says what it found, in the coverage card, where
 * the owner is deciding whether the record is worth showing a buyer.
 *
 * A broken chain is said plainly and sends the owner to support: it is not a
 * state the app can repair, and a retry button would suggest it might be.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, Row, Text, useTheme } from '@habba/ui';
import type { LogbookSeal } from '@/features/shared/data/types';
import { formatCount } from '@/features/shared/lib/format-number';

export interface LogbookSealStripProps {
  readonly seal: LogbookSeal;
  /** Whether the technician on a live job may read the summary (0108). */
  readonly sharedWithTechnician: boolean;
}

export function LogbookSealStrip({ seal, sharedWithTechnician }: LogbookSealStripProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const tone = seal.isValid ? 'success' : 'emergency';
  return (
    <View
      testID="logbook-seal"
      style={{
        gap: theme.spacing.xs,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: seal.isValid ? theme.colors.successSubtle : theme.colors.emergencySubtle,
      }}
    >
      <Row gap="sm">
        <Icon
          name={seal.isValid ? 'check' : 'alert'}
          size={theme.iconSize.sm}
          color={seal.isValid ? theme.colors.successFg : theme.colors.emergencyFg}
        />
        <Text variant="bodyStrong" tone={tone} style={{ flex: 1 }} testID="logbook-seal-title">
          {seal.isValid ? t('seal.title') : t('seal.brokenTitle')}
        </Text>
      </Row>
      <Text variant="caption" tone="muted">
        {seal.isValid
          ? t('seal.body', { entries: formatCount(seal.entries, i18n.language) })
          : t('seal.brokenBody')}
      </Text>
      {seal.odometerReplaced || seal.odometerCorrected ? (
        <Text variant="caption" tone="muted" testID="logbook-seal-odometer">
          {seal.odometerReplaced ? t('seal.odometerReplaced') : t('seal.odometerCorrected')}
        </Text>
      ) : null}
      {sharedWithTechnician ? (
        <Text variant="caption" tone="subtle">
          {t('seal.sharedWithTechnician')}
        </Text>
      ) : null}
    </View>
  );
}
