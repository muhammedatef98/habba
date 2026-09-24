/**
 * A document, read in the app.
 *
 * تقرير هبّة, the inspection report and the invoice could only leave the app —
 * generate, and the share sheet opened. Reading your own report meant sending
 * it to yourself first. Here it is on screen, from the same HTML the PDF is
 * printed from, with the PDF one button away for when it has to go somewhere.
 *
 * JavaScript is off in the web view: every document is static markup from a
 * renderer in @habba/core, with the QR drawn inline as SVG, so nothing in it
 * needs a script and nothing a payload carried could run one.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WebView } from 'react-native-webview';
import { Button, Icon, Row, Screen, Text, useTheme } from '@habba/ui';
import { shareDocumentPdf } from '@/features/shared/lib/report-pdf';
import { useDocumentViewer } from '@/features/shared/state/document-viewer';

export default function DocumentScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const document = useDocumentViewer((state) => state.document);
  const [shareFailed, setShareFailed] = useState(false);

  const share = useMutation({
    mutationFn: () =>
      document === null
        ? Promise.resolve({ ok: false as const, reason: 'render_failed' as const })
        : shareDocumentPdf(document),
    onMutate: () => setShareFailed(false),
    onSuccess: (result) => setShareFailed(!result.ok),
    onError: () => setShareFailed(true),
  });

  const back = (
    <Pressable
      testID="document-back"
      onPress={() => router.back()}
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
  );

  // Held in memory, so a cold start lands here with nothing to show.
  if (document === null) {
    return (
      <Screen style={{ gap: theme.spacing.md }}>
        <Row>{back}</Row>
        <Text variant="body" tone="muted">
          {t('documents.missing')}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen style={{ gap: theme.spacing.md }}>
      <Row gap="md">
        {back}
        <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>
          {document.title}
        </Text>
      </Row>

      {/* The page itself stays white in dark mode: it is a printed document,
          and the PDF it becomes is white too. */}
      <View
        testID="document-page"
        style={{
          flex: 1,
          borderRadius: theme.radius.md,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: '#FFFFFF',
        }}
      >
        <WebView
          originWhitelist={['*']}
          source={{ html: document.html }}
          javaScriptEnabled={false}
          startInLoadingState
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          style={{ flex: 1, backgroundColor: '#FFFFFF' }}
        />
      </View>

      {shareFailed ? (
        <Text variant="caption" tone="warning">
          {t('documents.shareFailed')}
        </Text>
      ) : null}

      <Button
        testID="document-share"
        label={t('documents.sharePdf')}
        onPress={() => share.mutate()}
        loading={share.isPending}
      />
    </Screen>
  );
}
