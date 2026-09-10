/**
 * The recipient's half of the handover — screens 6 and 7 of the design.
 *
 * §1.3 calls this the zero-CAC acquisition moment, and that is not a
 * decoration on the flow: the person reading this may have opened Habba for
 * the first time thirty seconds ago, standing next to a car they just bought.
 *
 * So it leads with the logbook's weight — how many records, how many
 * Habba-verified, how far back, what cover comes with it — BEFORE it asks for
 * anything. A code field first spends that moment on paperwork; it is the one
 * screen where the argument has to be made before the form.
 *
 * The weight is real data, not a pitch: it comes from
 * `pending_ownership_transfer_for_me()`, which is SECURITY DEFINER precisely
 * because the recipient cannot read `vehicles` or `vehicle_timeline` for this
 * car until they accept. A car with no history says so (`weightNone`) rather
 * than being dressed up — an overstated logbook here is the same lie ADR-0021
 * refused to let the report tell.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CodeInput,
  EmptyState,
  ErrorState,
  Icon,
  Row,
  Screen,
  SkeletonCard,
  Text,
  useTheme,
} from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { formatCount, formatShortDate } from '@/features/shared/lib/format-number';
import { daysUntil } from '@/features/shared/lib/transfer-window';
import { useIsAuthenticated } from '@/features/shared/state/session';
import type { IncomingTransfer } from '@/features/shared/data/types';

const CODE_LENGTH = 6;

export default function AcceptTransferScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const queryClient = useQueryClient();
  const isArabic = i18n.language.startsWith('ar');

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [acceptedVehicleId, setAcceptedVehicleId] = useState<string | null>(null);

  const incoming = useQuery({
    queryKey: ['transfer', 'incoming'],
    queryFn: () => repository.getIncomingTransfer(),
  });

  const accept = useMutation({
    mutationFn: (transferId: string) => repository.acceptTransfer(transferId, code),
    onSuccess: (vehicleId) => {
      setAcceptedVehicleId(vehicleId);
      setCodeError(undefined);
      // Everything about this account's cars just changed. The list, the
      // logbook, and the transfer itself all have to be re-read — a stale
      // vehicle list here is the buyer's very first impression of the product.
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['timeline', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['transfer', 'incoming'] });
    },
    onError: (error: Error) => {
      // The server gives one message for a wrong code and for a transfer
      // addressed to someone else, on purpose (0045): telling a stranger
      // holding a forwarded link which one it is tells them the transfer
      // exists. That indistinguishability is preserved here.
      setCodeError(
        error.message.toLowerCase().includes('not found')
          ? t('transfer.errors.gone')
          : t('transfer.errors.wrongCode'),
      );
    },
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const transfer = incoming.data ?? null;

  if (acceptedVehicleId !== null) {
    return (
      <Accepted
        vehicleId={acceptedVehicleId}
        records={transfer?.recordsTotal ?? 0}
        locale={i18n.language}
      />
    );
  }

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      {incoming.isError ? (
        <ErrorState
          testID="accept-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={incoming.isFetching}
          onRetry={() => void incoming.refetch()}
        />
      ) : incoming.isPending ? (
        <SkeletonCard testID="accept-skeleton" lines={4} />
      ) : transfer === null ? (
        // Null covers "nothing waiting", "addressed to an identity you have
        // not verified" and "expired" — one answer for all three, because the
        // server gives one answer for all three.
        <EmptyState
          testID="accept-empty"
          title={t('transfer.errors.gone')}
          body={t('transfer.verifiedNotice')}
          actionLabel={t('common.back')}
          onAction={() => router.back()}
        />
      ) : (
        <>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="label" tone="muted">
              {t('transfer.incomingTitle')}
            </Text>
            <Text variant="title">
              {isArabic
                ? `${transfer.makeAr} ${transfer.modelAr}`
                : `${transfer.makeEn} ${transfer.modelEn}`}
            </Text>
            <Row gap="sm" align="center" wrap>
              <Text variant="bodySmall" tone="muted" numeric>
                {formatCount(transfer.year, i18n.language)}
              </Text>
              {transfer.plate !== null ? (
                <Text variant="bodySmall" tone="muted" numeric>
                  {transfer.plate}
                </Text>
              ) : null}
            </Row>
          </View>

          <LogbookWeight transfer={transfer} />

          {/* The pitch, under the evidence rather than above it. Someone who
              has just read "43 records, 31 verified by Habba" is being told
              what that is worth; someone who reads it first is being sold to. */}
          <Card
            testID="accept-welcome"
            elevation="none"
            style={{ backgroundColor: theme.colors.surfaceSunken, gap: theme.spacing.sm }}
          >
            <Text variant="bodyStrong">{t('transfer.welcomeTitle')}</Text>
            <Text variant="bodySmall" tone="muted">
              {t('transfer.welcomeBody')}
            </Text>
          </Card>

          <View style={{ gap: theme.spacing.sm }}>
            <CodeInput
              testID="accept-code"
              value={code}
              onChangeText={(value) => {
                setCode(value);
                setCodeError(undefined);
              }}
              length={CODE_LENGTH}
              label={t('transfer.acceptCodeLabel')}
              error={codeError}
              autoFocus
            />
            <Text variant="caption" tone="muted">
              {t('transfer.acceptCodeHint')}
            </Text>
          </View>

          <Button
            testID="accept-submit"
            label={t('transfer.acceptAction')}
            loading={accept.isPending}
            disabled={code.length < CODE_LENGTH}
            onPress={() => accept.mutate(transfer.transferId)}
          />

          <Text variant="caption" tone="subtle">
            {t('transfer.acceptExpires', {
              days: formatCount(daysUntil(transfer.expiresAt), i18n.language),
            })}
          </Text>
        </>
      )}

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function LogbookWeight({ transfer }: { readonly transfer: IncomingTransfer }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  if (transfer.recordsTotal === 0) {
    return (
      <Card testID="accept-weight" elevation="sm">
        <Text variant="bodySmall" tone="muted">
          {t('transfer.weightNone')}
        </Text>
      </Card>
    );
  }

  return (
    <Card testID="accept-weight" elevation="sm" style={{ gap: theme.spacing.sm }}>
      <WeightLine
        icon="inspection"
        text={t('transfer.weightRecords', {
          count: formatCount(transfer.recordsTotal, i18n.language),
        })}
        strong
      />
      {transfer.habbaVerified > 0 ? (
        <WeightLine
          icon="check"
          colour={theme.colors.verified}
          text={t('transfer.weightVerified', {
            count: formatCount(transfer.habbaVerified, i18n.language),
          })}
        />
      ) : null}
      {transfer.firstRecordAt !== null ? (
        <WeightLine
          icon="calendar"
          text={t('transfer.weightSince', {
            date: formatShortDate(transfer.firstRecordAt, i18n.language),
          })}
        />
      ) : null}
      {/* ADR-0021 makes this cover the buyer's the moment they accept, so it is
          shown before they decide. Revealing it afterwards would be selling
          them the car on a fact they were not told. */}
      {transfer.openWarranties > 0 ? (
        <WeightLine
          icon="wrench"
          colour={theme.colors.successFg}
          text={t('transfer.weightWarranties', {
            count: formatCount(transfer.openWarranties, i18n.language),
          })}
        />
      ) : null}
    </Card>
  );
}

function WeightLine({
  icon,
  text,
  colour,
  strong = false,
}: {
  readonly icon: 'inspection' | 'check' | 'calendar' | 'wrench';
  readonly text: string;
  readonly colour?: string | undefined;
  readonly strong?: boolean;
}) {
  const theme = useTheme();

  return (
    <Row gap="sm" align="center">
      <Icon name={icon} size={theme.iconSize.sm} color={colour ?? theme.colors.textMuted} />
      <Text variant={strong ? 'bodyStrong' : 'bodySmall'} tone={strong ? 'default' : 'muted'}>
        {text}
      </Text>
    </Row>
  );
}

function Accepted({
  vehicleId,
  records,
  locale,
}: {
  readonly vehicleId: string;
  readonly records: number;
  readonly locale: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Screen style={{ gap: theme.spacing.lg, justifyContent: 'center' }}>
      <Card testID="accept-done" elevation="sm" style={{ gap: theme.spacing.md }}>
        <Row gap="sm" align="center">
          <Icon name="check" size={theme.iconSize.md} color={theme.colors.successFg} />
          <Text variant="subheading">{t('transfer.acceptedTitle')}</Text>
        </Row>
        <Text variant="body" tone="muted">
          {t('transfer.acceptedBody', { count: formatCount(records, locale) })}
        </Text>
      </Card>

      <Button
        testID="accept-open-logbook"
        label={t('transfer.acceptedAction')}
        onPress={() => router.replace({ pathname: '/logbook', params: { id: vehicleId } })}
      />
    </Screen>
  );
}
