/**
 * Holds a signed-in person at «قبل أن نبدأ» / «حدّثنا شروطنا» until they have
 * accepted the terms and privacy policy in force — and the provider terms, if
 * they have applied as a provider (0083).
 *
 * The tap on «أوافق وأتابع» is what the database records: who, which version,
 * when, from where. That record, not the sentence on the sign-in screen, is
 * what shows a person agreed.
 *
 * This is not a security boundary, and fails open: while the list loads, or
 * if it cannot be read, the app opens as usual and asks again next time.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { LegalDocumentKind } from '@habba/core';
import { Button, Card, HabbaMark, Icon, ListRow, Row, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { LegalDocumentView } from '@/features/shared/components/LegalDocumentView';
import { useSession } from '@/features/shared/state/session';

const TITLE_KEY: Record<LegalDocumentKind, string> = {
  terms: 'legal.terms',
  privacy: 'legal.privacy',
  provider_terms: 'legal.providerTerms',
};

export function LegalGate({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const userId = useSession((state) => state.userId);
  const [reading, setReading] = useState<LegalDocumentKind | null>(null);

  const pending = useQuery({
    queryKey: ['legal-pending', userId],
    queryFn: () => repository.listPendingLegalDocuments(),
    enabled: userId !== null,
    staleTime: 5 * 60_000,
  });

  const accept = useMutation({
    mutationFn: (ids: readonly string[]) => repository.acceptLegalDocuments(ids),
    // Said on this screen; the app-wide toast would say it twice.
    meta: { inlineError: true },
    // Superseded while reading, or accepted: either way, ask the server again.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['legal-pending'] }),
  });

  const documents = pending.data ?? [];
  if (userId === null || documents.length === 0) return <>{children}</>;

  if (reading !== null) {
    return (
      <Screen scrollable style={{ gap: theme.spacing.lg }}>
        <Row>
          <Pressable
            testID="legal-gate-back"
            onPress={() => setReading(null)}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={({ pressed }) => [
              {
                width: 40,
                height: 40,
                borderRadius: theme.radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.surfaceSunken,
              },
              pressed ? { opacity: 0.6 } : null,
            ]}
          >
            <Icon name="chevronBack" size={theme.iconSize.sm} color={theme.colors.text} />
          </Pressable>
        </Row>
        <LegalDocumentView kind={reading} />
      </Screen>
    );
  }

  // Everything pending is a first version: a new account, not a change.
  const first = documents.every((document) => document.version === 1);

  return (
    <Screen scrollable>
      <View
        testID="legal-gate"
        style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}
      >
        <Row>
          <HabbaMark size={56} />
        </Row>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="title">
            {first ? t('legal.gateTitleFirst') : t('legal.gateTitleUpdated')}
          </Text>
          <Text variant="body" tone="muted">
            {first ? t('legal.gateBodyFirst') : t('legal.gateBodyUpdated')}
          </Text>
        </View>

        <Card elevation="none" style={{ borderColor: theme.colors.border, borderWidth: 1 }}>
          {documents.map((document) => (
            <ListRow
              key={document.id}
              testID={`legal-gate-${document.kind}`}
              title={t(TITLE_KEY[document.kind])}
              subtitle={
                first || document.summaryAr === null
                  ? t('legal.gateVersion', { version: document.version })
                  : `${t('legal.gateVersion', { version: document.version })} — ${document.summaryAr}`
              }
              value={t('legal.gateRead')}
              onPress={() => setReading(document.kind)}
            />
          ))}
        </Card>

        {accept.isError ? (
          <Text variant="bodySmall" tone="emergency">
            {t('legal.gateAcceptFailed')}
          </Text>
        ) : null}

        <Button
          testID="legal-gate-accept"
          label={t('legal.gateAccept')}
          loading={accept.isPending}
          onPress={() => accept.mutate(documents.map((document) => document.id))}
        />
      </View>
    </Screen>
  );
}
