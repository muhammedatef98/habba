/**
 * فواتيري — every tax invoice in one place.
 *
 * An invoice was reachable only from its order's completion screen, which is
 * where nobody looks for it three months later when an employer or a
 * warranty claim asks for one. Here they are newest first; a row opens the
 * invoice in the viewer, where it is one button from being a PDF.
 *
 * The list holds summaries only. The full document — lines, seller, QR — is
 * read when a row is opened, so a long history costs one small query.
 */

import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Card,
  ErrorState,
  FadeIn,
  Icon,
  Screen,
  SkeletonCard,
  staggerDelay,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import { EmptyState } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import type { InvoiceSummary } from '@/features/shared/data/types';
import { formatShortDate } from '@/features/shared/lib/format-number';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { invoiceDocument } from '@/features/shared/lib/report-pdf';
import { useDocumentViewer } from '@/features/shared/state/document-viewer';
import { BackBar } from '@/features/shared/components/BackBar';

export default function InvoicesScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const show = useDocumentViewer((state) => state.show);
  const [failed, setFailed] = useState(false);

  const invoices = useQuery({
    queryKey: ['invoices'],
    queryFn: () => repository.listInvoices(),
  });

  const open = useMutation({
    mutationFn: async (orderId: string) => {
      const invoice = await repository.getOrderInvoice(orderId);
      if (invoice === null) throw new Error('invoice_missing');
      return invoiceDocument(invoice, t('documents.invoice'));
    },
    onMutate: () => setFailed(false),
    onSuccess: (document) => {
      show(document);
      router.push('/document');
    },
    onError: () => setFailed(true),
  });

  if (invoices.isPending) {
    return (
      <Screen style={{ gap: theme.spacing.lg }}>
        <BackBar label={t('settings.title')} />
        <Text variant="title">{t('invoices.title')}</Text>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('common.loading')}
          style={{ gap: theme.spacing.md }}
        >
          <SkeletonCard testID="invoices-skeleton" />
          <SkeletonCard />
        </View>
      </Screen>
    );
  }

  if (invoices.isError) {
    return (
      <Screen style={{ gap: theme.spacing.lg }}>
        <BackBar label={t('settings.title')} />
        <Text variant="title">{t('invoices.title')}</Text>
        <ErrorState
          testID="invoices-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={invoices.isFetching}
          onRetry={() => void invoices.refetch()}
        />
      </Screen>
    );
  }

  const rows = invoices.data;

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <BackBar label={t('settings.title')} />
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('invoices.title')}</Text>
        <Text variant="bodySmall" tone="muted">
          {t('invoices.subtitle')}
        </Text>
      </View>

      {rows.length === 0 ? (
        <EmptyState
          testID="invoices-empty"
          iconName="wallet"
          title={t('invoices.empty')}
          body={t('invoices.emptyBody')}
        />
      ) : (
        <Card elevation="none" style={{ paddingVertical: theme.spacing.xs }}>
          {rows.map((invoice, index) => (
            <FadeIn
              key={invoice.orderId}
              delay={staggerDelay(index)}
              style={
                index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: theme.colors.border }
              }
            >
              <InvoiceRow
                invoice={invoice}
                isArabic={i18n.language.startsWith('ar')}
                language={i18n.language}
                opening={open.isPending && open.variables === invoice.orderId}
                disabled={open.isPending}
                onPress={() => open.mutate(invoice.orderId)}
              />
            </FadeIn>
          ))}
        </Card>
      )}

      {failed ? (
        <Text variant="caption" tone="emergency">
          {t('invoices.openFailed')}
        </Text>
      ) : null}
    </Screen>
  );
}

function InvoiceRow({
  invoice,
  isArabic,
  language,
  opening,
  disabled,
  onPress,
}: {
  readonly invoice: InvoiceSummary;
  readonly isArabic: boolean;
  readonly language: string;
  readonly opening: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const service = isArabic ? invoice.serviceNameAr : invoice.serviceNameEn;
  const amount = t('common.sar', { amount: formatSarDisplay(invoice.total) });

  return (
    <Pressable
      testID="invoices-row"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        invoice.credited === null
          ? `${t('documents.viewInvoice')} — ${service} — ${amount}`
          : `${t('documents.viewInvoice')} — ${service} — ${amount} — ${t('invoices.credited', {
              amount: t('common.sar', { amount: formatSarDisplay(invoice.credited) }),
            })}`
      }
      accessibilityState={{ busy: opening, disabled }}
      style={({ pressed }) => [
        {
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          gap: theme.spacing.md,
          minHeight: theme.minTouchTarget,
          paddingVertical: theme.spacing.sm,
        },
        pressed ? { opacity: 0.6 } : null,
      ]}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surfaceSunken,
        }}
      >
        <Icon name="wallet" size={theme.iconSize.sm} color={theme.colors.textMuted} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodySmall" numberOfLines={1}>
          {service}
        </Text>
        <Text variant="caption" tone="subtle" numeric numberOfLines={1}>
          {/* Isolated (FSI … PDI): a Latin invoice number beside an Arabic
              date otherwise reorders into «سبتمبر HB-INV-… · 25». */}
          {`\u2068${invoice.invoiceNumber}\u2069 · \u2068${formatShortDate(invoice.issuedAt, language)}\u2069`}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text variant="caption" tone="muted" numeric>
          {amount}
        </Text>
        {invoice.credited !== null ? (
          // A refund was credited against it (0096); the note is in the document.
          <Text testID="invoices-row-credited" variant="caption" tone="subtle" numeric>
            {t('invoices.credited', {
              amount: t('common.sar', { amount: formatSarDisplay(invoice.credited) }),
            })}
          </Text>
        ) : null}
      </View>

      {opening ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : (
        <Icon name="chevronForward" size={theme.iconSize.sm} color={theme.colors.textSubtle} />
      )}
    </Pressable>
  );
}
