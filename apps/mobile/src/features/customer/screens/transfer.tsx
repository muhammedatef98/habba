/**
 * نقل الملكية — the seller's half of the handover.
 *
 * §1.3 makes the buyer → owner handover a zero-CAC acquisition channel: the new
 * owner receives the logbook and becomes a Habba account without anyone paying
 * for them. That channel has been closed twice — ADR-0019 removed the public
 * report page, then 0037 gated discovery on a flag nothing set — and 0044/0045
 * reopened it in the database. This screen is the half no human could reach.
 *
 * One route, six states, because they are one act and the seller should never
 * wonder which screen they are on:
 *
 *   warn      what the logbook leaving actually costs, with the PDF offer while
 *             taking it is still possible
 *   address   phone or email, and a review before anything is created
 *   code      the six digits, shown once, read aloud rather than sent
 *   pending   the wait, and the withdrawal
 *   expired   the seven days running out, which is a state and not an error
 *   exhausted the buyer spent all five attempts and the code is dead (0056/0057)
 *
 * The route opens straight into `pending`, `exhausted` or `expired` when the
 * car already has a transfer — coming back to check on one is the common visit,
 * not starting another.
 *
 * `exhausted` exists because the state underneath it used to be invisible: the
 * row locks but stays `pending`, so this screen said «بانتظار قبول المشتري»
 * over a code that had stopped working, and the car stayed blocked until
 * somebody cancelled by hand. Its action is `reissueTransfer`, which is one
 * call rather than cancel-then-initiate: two taps would leave a window where
 * the car has no transfer, and a cancel whose re-issue then failed would take
 * away what the seller had.
 *
 * The code is deliberately held in component state and nowhere else. It is
 * returned by the server exactly once; the row stores a hash, and no client can
 * read even that (0054). Putting it in a query cache would make a screen
 * possible that production cannot serve.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { parseSaudiPhone, SAUDI_COUNTRY_CODE } from '@habba/core';
import {
  BottomSheet,
  Button,
  Card,
  CodeInput,
  ErrorState,
  Field,
  Icon,
  Row,
  Screen,
  SkeletonCard,
  Text,
  useTheme,
} from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { shareHabbaReportPdf } from '@/features/shared/lib/report-pdf';
import { formatCount } from '@/features/shared/lib/format-number';
import { daysUntil } from '@/features/shared/lib/transfer-window';
import { describeVehicleModel, vehicleLabel } from '@/features/shared/lib/vehicle-label';
import { useIsAuthenticated } from '@/features/shared/state/session';

type Stage = 'warn' | 'address' | 'code';
type Channel = 'phone' | 'email';

/** Same shape the database checks in `ownership_transfers_to_email_shape`. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function TransferScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isArabic = i18n.language.startsWith('ar');

  const [stage, setStage] = useState<Stage>('warn');
  const [channel, setChannel] = useState<Channel>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addressError, setAddressError] = useState<string | undefined>(undefined);
  const [mintedCode, setMintedCode] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportShared, setReportShared] = useState(false);

  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => repository.getVehicle(id ?? ''),
    enabled: id !== undefined,
  });

  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const models = useQuery({
    queryKey: ['models', 'all'],
    queryFn: () => repository.listAllModels(),
  });

  const outgoing = useQuery({
    queryKey: ['transfer', 'outgoing', id],
    queryFn: () => repository.getOutgoingTransfer(id ?? ''),
    enabled: id !== undefined,
  });

  const initiate = useMutation({
    mutationFn: (address: { phone?: string; email?: string }) =>
      repository.initiateTransfer({ vehicleId: id ?? '', ...address }),
    onSuccess: (minted) => {
      setMintedCode(minted.code);
      setActionError(null);
      setStage('code');
      void queryClient.invalidateQueries({ queryKey: ['transfer', 'outgoing', id] });
    },
    onError: (error: Error) => setActionError(messageFor(error, t)),
  });

  const cancel = useMutation({
    mutationFn: (transferId: string) => repository.cancelTransfer(transferId),
    onSuccess: () => {
      setConfirmingCancel(false);
      setMintedCode(null);
      setStage('warn');
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['transfer', 'outgoing', id] });
    },
    onError: () => {
      setConfirmingCancel(false);
      setActionError(t('transfer.errors.cancelFailed'));
    },
  });

  // Cancel and re-issue as one act. It lands on the same `code` screen a first
  // issue lands on, because from the seller's side that is what just happened:
  // there is a new code to read to the buyer, and nothing else changed.
  const reissue = useMutation({
    mutationFn: (transferId: string) => repository.reissueTransfer(transferId),
    onSuccess: (minted) => {
      setMintedCode(minted.code);
      setActionError(null);
      setStage('code');
      void queryClient.invalidateQueries({ queryKey: ['transfer', 'outgoing', id] });
    },
    onError: (error: Error) =>
      setActionError(
        error.message.toLowerCase().includes('warranty claim is open')
          ? t('transfer.errors.claimOpen')
          : t('transfer.errors.reissueFailed'),
      ),
  });

  // The same issue-read-render-share sequence the logbook uses. It is offered
  // HERE, on the warning screen, because after acceptance the seller can no
  // longer generate a report for this car at all — offering the export
  // afterwards would be offering it too late.
  const report = useMutation({
    mutationFn: async () => {
      const token = await repository.generateReport(id ?? '');
      const payload = await repository.getReport(token);
      if (payload === null) throw new Error('report_missing');
      return shareHabbaReportPdf(payload);
    },
    onSuccess: (result) => {
      setReportShared(result.ok);
      setReportError(result.ok ? null : t('logbook.errors.reportShareUnavailable'));
    },
    onError: () => setReportError(t('logbook.errors.reportFailed')),
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const car = vehicle.data;
  const sources = { makes: makes.data, models: models.data, isArabic };
  const carLabel =
    car === null || car === undefined
      ? t('logbook.vehicleUnknown')
      : (car.nickname?.trim().length ?? 0) > 0
        ? (car.nickname as string)
        : describeVehicleModel(car, sources) || vehicleLabel(car, sources);

  const pending = outgoing.data ?? null;
  const remainingDays = pending === null ? 0 : daysUntil(pending.expiresAt);

  function submitAddress() {
    setActionError(null);

    if (channel === 'phone') {
      const parsed = parseSaudiPhone(phone);
      if (!parsed.ok) {
        setAddressError(
          t(
            parsed.error === 'empty'
              ? 'transfer.errors.addressRequired'
              : 'transfer.errors.phoneShape',
          ),
        );
        return;
      }
      setAddressError(undefined);
      // E.164, because that is what the column's check constraint accepts and
      // what `profiles.phone` is matched against. Sending what the seller typed
      // would address the transfer to a string nobody's account holds.
      initiate.mutate({ phone: parsed.e164 });
      return;
    }

    const trimmed = email.trim().toLowerCase();
    if (trimmed.length === 0) {
      setAddressError(t('transfer.errors.addressRequired'));
      return;
    }
    if (!EMAIL_SHAPE.test(trimmed)) {
      setAddressError(t('transfer.errors.emailShape'));
      return;
    }
    setAddressError(undefined);
    initiate.mutate({ email: trimmed });
  }

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="label" tone="muted">
          {t('transfer.entry')}
        </Text>
        <Text variant="title">{carLabel}</Text>
        {car?.plateNormalised != null ? (
          <Text variant="bodySmall" tone="muted" numeric>
            {car.plateNormalised}
          </Text>
        ) : null}
      </View>

      {outgoing.isError ? (
        <ErrorState
          testID="transfer-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={outgoing.isFetching}
          onRetry={() => void outgoing.refetch()}
        />
      ) : outgoing.isPending ? (
        <SkeletonCard testID="transfer-skeleton" lines={3} />
      ) : mintedCode !== null && stage === 'code' ? (
        <CodeHandover
          code={mintedCode}
          onDone={() => {
            setMintedCode(null);
            setStage('warn');
          }}
        />
      ) : pending !== null && pending.attemptsExhausted && remainingDays > 0 ? (
        // Ahead of `pending`: a locked transfer IS still pending, and saying
        // «بانتظار قبول المشتري» over a code that stopped working is the exact
        // dead end this state was added to close.
        <ExhaustedTransfer
          to={pending.toPhone ?? pending.toEmail ?? ''}
          reissuing={reissue.isPending}
          onReissue={() => reissue.mutate(pending.id)}
        />
      ) : pending !== null && remainingDays > 0 ? (
        <PendingTransfer
          to={pending.toPhone ?? pending.toEmail ?? ''}
          remainingDays={remainingDays}
          cancelling={cancel.isPending}
          onCancel={() => setConfirmingCancel(true)}
        />
      ) : pending !== null ? (
        // Lapsed. `getOutgoingTransfer` returns the row past its expiry on
        // purpose: `expire_ownership_transfers` runs on initiation and on a
        // sweep, not on a clock, and a seller coming back on day eight needs to
        // be told the code stopped working rather than shown a fresh warning
        // screen with no explanation for why their transfer disappeared.
        <ExpiredTransfer onRestart={() => setStage('warn')} />
      ) : stage === 'warn' ? (
        <View style={{ gap: theme.spacing.lg }}>
          <Card testID="transfer-warning" elevation="sm" style={{ gap: theme.spacing.md }}>
            <Text variant="subheading">{t('transfer.warnTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('transfer.warnBody')}
            </Text>

            {/* Kept and lost, side by side and equally weighted. Listing only
                the losses reads as a warning to be clicked past; listing only
                the keeps is the sentence that gets a seller angry later. */}
            <View style={{ gap: theme.spacing.md }}>
              <LedgerBlock
                icon="check"
                tone="success"
                title={t('transfer.keepsTitle')}
                body={t('transfer.keepsBody')}
              />
              <LedgerBlock
                icon="alert"
                tone="warning"
                title={t('transfer.losesTitle')}
                body={`${t('transfer.losesBody')} ${t('transfer.losesWarranty')}`}
              />
            </View>
          </Card>

          <Card elevation="none" style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong">{t('transfer.pdfOffer')}</Text>
            <Text variant="caption" tone="muted">
              {t('transfer.pdfOfferHint')}
            </Text>
            <Button
              testID="transfer-report"
              label={t('logbook.generateReport')}
              variant="accent"
              size="medium"
              loading={report.isPending}
              onPress={() => report.mutate()}
            />
            {reportShared ? (
              <Text variant="caption" tone="success">
                {t('logbook.reportReady')}
              </Text>
            ) : null}
            {reportError !== null ? (
              <Text variant="caption" tone="emergency">
                {reportError}
              </Text>
            ) : null}
          </Card>

          <Button
            testID="transfer-continue"
            label={t('transfer.warnContinue')}
            onPress={() => setStage('address')}
          />
        </View>
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="subheading">{t('transfer.addressTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('transfer.addressBody')}
            </Text>
          </View>

          <Row gap="sm">
            {(['phone', 'email'] as const).map((option) => {
              const selected = channel === option;
              return (
                <Card
                  key={option}
                  testID={`transfer-channel-${option}`}
                  elevation="none"
                  onPress={() => {
                    setChannel(option);
                    setAddressError(undefined);
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: theme.spacing.sm,
                    alignItems: 'center',
                    borderRadius: theme.radius.full,
                    backgroundColor: selected
                      ? theme.colors.primarySubtle
                      : theme.colors.surfaceSunken,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    borderWidth: selected ? 1.5 : 1,
                  }}
                >
                  <Text variant="bodySmall" tone={selected ? 'primary' : 'muted'}>
                    {t(option === 'phone' ? 'transfer.byPhone' : 'transfer.byEmail')}
                  </Text>
                </Card>
              );
            })}
          </Row>

          {channel === 'phone' ? (
            <Field
              testID="transfer-phone"
              label={t('transfer.phoneLabel')}
              value={phone}
              onChangeText={(value) => {
                setPhone(value);
                setAddressError(undefined);
              }}
              error={addressError}
              keyboardType="phone-pad"
              maxLength={16}
              prefix={`+${SAUDI_COUNTRY_CODE}`}
              forceLtrInput
            />
          ) : (
            <Field
              testID="transfer-email"
              label={t('transfer.emailLabel')}
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                setAddressError(undefined);
              }}
              error={addressError}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              forceLtrInput
            />
          )}

          {/* Discovery requires a VERIFIED identity (0045). Without this line a
              seller who types a number the buyer has never confirmed watches
              the transfer vanish with no explanation available to either of
              them — the refusal is silent by design, so the warning cannot be. */}
          <Card
            elevation="none"
            style={{ backgroundColor: theme.colors.surfaceSunken, gap: theme.spacing.xs }}
          >
            <Text variant="caption" tone="muted">
              {t('transfer.verifiedNotice')}
            </Text>
          </Card>

          <Card testID="transfer-confirm" elevation="none" style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong">{t('transfer.confirmTitle')}</Text>
            <ConfirmRow label={t('transfer.confirmVehicle')} value={carLabel} />
            <ConfirmRow
              label={t('transfer.confirmTo')}
              value={
                channel === 'phone'
                  ? phone.trim().length > 0
                    ? `+${SAUDI_COUNTRY_CODE} ${phone.trim()}`
                    : '—'
                  : email.trim().length > 0
                    ? email.trim()
                    : '—'
              }
              numeric={channel === 'phone'}
            />
            <ConfirmRow
              label={t('transfer.confirmWindow')}
              value={t('transfer.confirmWindowValue')}
            />
          </Card>

          <Button
            testID="transfer-create"
            label={t('transfer.confirmAction')}
            loading={initiate.isPending}
            onPress={submitAddress}
          />

          {actionError !== null ? (
            <Text variant="caption" tone="emergency">
              {actionError}
            </Text>
          ) : null}
        </View>
      )}

      {/* «إلغاء النقل» asks first. The code is already in the buyer's hands and
          cancelling invalidates it — an accidental tap here is a conversation
          at the kerb, not an undo. */}
      <BottomSheet
        visible={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        title={t('transfer.cancelConfirmTitle')}
        closeLabel={t('common.close')}
        testID="transfer-cancel-sheet"
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="body" tone="muted">
            {t('transfer.cancelConfirmBody')}
          </Text>
          <Button
            testID="transfer-cancel-confirm"
            label={t('transfer.cancelConfirmAction')}
            variant="emergencyOutline"
            loading={cancel.isPending}
            onPress={() => {
              if (pending !== null) cancel.mutate(pending.id);
            }}
          />
          <Button
            label={t('transfer.cancelKeep')}
            variant="ghost"
            onPress={() => setConfirmingCancel(false)}
          />
        </View>
      </BottomSheet>

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function messageFor(error: Error, t: (key: string) => string): string {
  const message = error.message.toLowerCase();
  if (message.includes('your own contact')) return t('transfer.errors.ownContact');
  if (message.includes('already pending')) return t('transfer.errors.alreadyPending');
  if (message.includes('warranty claim is open')) return t('transfer.errors.claimOpen');
  return t('transfer.errors.initiateFailed');
}

function LedgerBlock({
  icon,
  tone,
  title,
  body,
}: {
  readonly icon: 'check' | 'alert';
  readonly tone: 'success' | 'warning';
  readonly title: string;
  readonly body: string;
}) {
  const theme = useTheme();
  const colour = tone === 'success' ? theme.colors.successFg : theme.colors.warningFg;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Row gap="sm" align="center">
        <Icon name={icon} size={theme.iconSize.sm} color={colour} />
        <Text variant="bodyStrong">{title}</Text>
      </Row>
      <Text variant="bodySmall" tone="muted">
        {body}
      </Text>
    </View>
  );
}

function ConfirmRow({
  label,
  value,
  numeric = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly numeric?: boolean;
}) {
  return (
    <Row gap="md" justify="space-between" align="center">
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="bodySmall" numeric={numeric} align="end" style={{ flex: 1 }}>
        {value}
      </Text>
    </Row>
  );
}

function CodeHandover({ code, onDone }: { readonly code: string; readonly onDone: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="subheading">{t('transfer.codeTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('transfer.codeBody')}
        </Text>
      </View>

      {/* Read-only: the boxes are the same shape the buyer will type into, so
          the seller is looking at what the buyer is about to see. `CodeInput`
          with no handler is deliberate — there is nothing to change here. */}
      <CodeInput
        testID="transfer-code"
        value={code}
        onChangeText={() => undefined}
        length={6}
        label={t('transfer.codeTitle')}
      />

      <Card
        elevation="none"
        style={{ backgroundColor: theme.colors.surfaceSunken, gap: theme.spacing.xs }}
      >
        <Text variant="caption" tone="muted">
          {t('transfer.codeOnce')}
        </Text>
      </Card>

      <Button testID="transfer-code-done" label={t('transfer.codeDone')} onPress={onDone} />
    </View>
  );
}

function PendingTransfer({
  to,
  remainingDays,
  cancelling,
  onCancel,
}: {
  readonly to: string;
  readonly remainingDays: number;
  readonly cancelling: boolean;
  readonly onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Card testID="transfer-pending" elevation="sm" style={{ gap: theme.spacing.md }}>
        <Text variant="subheading">{t('transfer.pendingTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('transfer.pendingTo', { to })}
        </Text>
        <Text variant="bodySmall" tone="subtle">
          {remainingDays === 1
            ? t('transfer.pendingExpiresToday')
            : t('transfer.pendingExpires', { days: formatCount(remainingDays, i18n.language) })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('transfer.pendingStillYours')}
        </Text>
      </Card>

      <Button
        testID="transfer-cancel"
        label={t('transfer.cancelAction')}
        variant="secondary"
        loading={cancelling}
        onPress={onCancel}
      />
    </View>
  );
}

/**
 * The buyer spent all five attempts, and the code is dead (0056).
 *
 * Same register as `ExpiredTransfer`, and for the same reason: nothing went
 * wrong that anybody needs to answer for. Somebody misheard six digits at a
 * kerb five times, which is an ordinary thing to happen. So it says what
 * happened, says what did not change, and offers the one action that helps —
 * without telling the seller their buyer is careless or the buyer that they are
 * suspected of anything.
 *
 * One button, and it is `reissueTransfer`: the server cancels and re-issues in
 * one transaction, so the seller never holds a car with no transfer on it.
 */
function ExhaustedTransfer({
  to,
  reissuing,
  onReissue,
}: {
  readonly to: string;
  readonly reissuing: boolean;
  readonly onReissue: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Card testID="transfer-exhausted" elevation="sm" style={{ gap: theme.spacing.md }}>
        <Text variant="subheading">{t('transfer.exhaustedTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('transfer.exhaustedBody')}
        </Text>
        <Text variant="bodySmall" tone="subtle">
          {t('transfer.pendingTo', { to })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('transfer.exhaustedHint')}
        </Text>
      </Card>

      <Button
        testID="transfer-reissue"
        label={t('transfer.exhaustedAction')}
        loading={reissuing}
        onPress={onReissue}
      />
    </View>
  );
}

/**
 * The seven days running out.
 *
 * A state, not an error: nothing went wrong, the buyer simply never accepted,
 * and the seller has lost nothing. Saying that plainly is the difference
 * between a screen someone trusts and one they think ate their car.
 */
function ExpiredTransfer({ onRestart }: { readonly onRestart: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Card testID="transfer-expired" elevation="sm" style={{ gap: theme.spacing.md }}>
        <Text variant="subheading">{t('transfer.expiredTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('transfer.expiredBody')}
        </Text>
      </Card>

      <Button testID="transfer-restart" label={t('transfer.expiredAction')} onPress={onRestart} />
    </View>
  );
}
