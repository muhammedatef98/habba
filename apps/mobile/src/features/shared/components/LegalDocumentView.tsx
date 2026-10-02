/**
 * A legal document (0083), laid out natively from the Markdown subset
 * @habba/core parses: text the platform sets, so it follows the theme, the
 * reading direction and the person's font size, which a web view would not.
 *
 * Arabic is authoritative. In English the translation is shown, and the text
 * itself says the Arabic prevails.
 */

import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { parseLegalDocument, type LegalDocumentKind } from '@habba/core';
import { ErrorState, Row, Skeleton, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';

export function useLegalDocument(kind: LegalDocumentKind) {
  return useQuery({
    queryKey: ['legal-document', kind],
    queryFn: () => repository.getLegalDocument(kind),
    staleTime: 10 * 60_000,
  });
}

export function LegalDocumentView({ kind }: { readonly kind: LegalDocumentKind }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const document = useLegalDocument(kind);

  if (document.isPending) {
    return (
      <View style={{ gap: theme.spacing.md }}>
        <Skeleton height={32} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </View>
    );
  }
  if (document.isError) {
    return (
      <ErrorState
        testID="legal-error"
        message={t('legal.loadFailed')}
        onRetry={() => void document.refetch()}
        retryLabel={t('common.retry')}
        retrying={document.isFetching}
      />
    );
  }

  const body = i18n.language.startsWith('ar') ? document.data.bodyAr : document.data.bodyEn;

  return (
    <View testID={`legal-document-${kind}`} style={{ gap: theme.spacing.md }}>
      {parseLegalDocument(body).map((block, index) => {
        switch (block.type) {
          case 'title':
            return (
              <Text key={index} variant="title">
                {block.text}
              </Text>
            );
          case 'heading':
            return (
              <Text key={index} variant="subheading" style={{ marginTop: theme.spacing.sm }}>
                {block.text}
              </Text>
            );
          case 'note':
            return (
              <Text key={index} variant="bodySmall" tone="subtle">
                {block.text}
              </Text>
            );
          case 'paragraph':
          case 'bullet': {
            const runs = block.runs.map((run, runIndex) =>
              run.bold ? (
                <Text key={runIndex} variant="body" style={{ fontWeight: '600' }}>
                  {run.text}
                </Text>
              ) : (
                run.text
              ),
            );
            if (block.type === 'paragraph') {
              return (
                <Text key={index} variant="body" tone="muted">
                  {runs}
                </Text>
              );
            }
            return (
              <Row key={index} gap="sm" align="flex-start">
                <Text variant="body" tone="subtle">
                  •
                </Text>
                <Text variant="body" tone="muted" style={{ flex: 1 }}>
                  {runs}
                </Text>
              </Row>
            );
          }
        }
      })}
    </View>
  );
}
