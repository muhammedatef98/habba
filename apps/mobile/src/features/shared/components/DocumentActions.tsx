/**
 * «عرض» and «مشاركة PDF», side by side, for any document the app produces.
 *
 * Reading and sending are both first-class: most people want to look at a
 * report before they forward it, and some only ever want to look. Either
 * button prepares the document on first use — for تقرير هبّة that means the
 * server issues a report (a token and a frozen payload) — and keeps it, so
 * viewing and then sharing issue one report, not two.
 */

import { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Row, Text, useTheme } from '@habba/ui';
import { shareDocumentPdf, type ViewableDocument } from '@/features/shared/lib/report-pdf';
import { useDocumentViewer } from '@/features/shared/state/document-viewer';

export interface DocumentActionsProps {
  /** Builds the document; called once, on the first press of either button. */
  readonly load: () => Promise<ViewableDocument>;
  readonly viewLabel: string;
  /** The view button's weight; the share button is always the quieter one. */
  readonly viewVariant?: 'primary' | 'accent' | undefined;
  /** Once, when the document first exists — for a screen that confirms it. */
  readonly onPrepared?: (() => void) | undefined;
  /** For a failure to build the document (the share sheet's own is handled here). */
  readonly onLoadError?: ((error: Error) => void) | undefined;
  readonly testID: string;
}

export function DocumentActions({
  load,
  viewLabel,
  viewVariant = 'primary',
  onPrepared,
  onLoadError,
  testID,
}: DocumentActionsProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const show = useDocumentViewer((state) => state.show);
  const prepared = useRef<ViewableDocument | null>(null);
  const [shareFailed, setShareFailed] = useState(false);

  const prepare = async () => {
    if (prepared.current === null) {
      prepared.current = await load();
      onPrepared?.();
    }
    return prepared.current;
  };

  const view = useMutation({
    mutationFn: prepare,
    onSuccess: (document) => {
      show(document);
      router.push('/document');
    },
    onError: (error: Error) => onLoadError?.(error),
  });

  const share = useMutation({
    mutationFn: async () => shareDocumentPdf(await prepare()),
    onMutate: () => setShareFailed(false),
    onSuccess: (result) => setShareFailed(!result.ok),
    onError: (error: Error) => onLoadError?.(error),
  });

  return (
    <View testID={testID} style={{ gap: theme.spacing.xs }}>
      <Row gap="sm">
        <View style={{ flex: 1 }}>
          <Button
            testID={`${testID}-view`}
            label={viewLabel}
            variant={viewVariant}
            size="medium"
            onPress={() => view.mutate()}
            loading={view.isPending}
            disabled={share.isPending}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID={`${testID}-share`}
            label={t('documents.sharePdfShort')}
            variant="secondary"
            size="medium"
            onPress={() => share.mutate()}
            loading={share.isPending}
            disabled={view.isPending}
          />
        </View>
      </Row>
      {shareFailed ? (
        <Text variant="caption" tone="warning">
          {t('documents.shareFailed')}
        </Text>
      ) : null}
    </View>
  );
}
