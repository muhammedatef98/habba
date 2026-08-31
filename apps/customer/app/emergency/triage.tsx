/**
 * Screen 04 — optional 20-second video triage.
 *
 * §1's third differentiator: a provider who has seen the problem can quote and
 * bring the right part before driving out, which kills the false dispatch that
 * is the main cost in this business.
 *
 * The order has already been submitted by this point and matching is running
 * in the background — that is what makes the step genuinely skippable, and the
 * screen says so rather than implying the customer is holding things up.
 *
 * Camera capture itself is still open work (it is the same gap as the provider
 * app's evidence screen). Until expo-camera is wired, this screen states that
 * plainly and offers the skip. It does not present a fake viewfinder: a
 * recording UI that silently discards the recording would be worse than an
 * honest absence.
 */

import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';

export default function VideoTriageScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const goToTracking = () => router.replace({ pathname: '/tracking', params: { id: id ?? '' } });

  return (
    <Screen scrollable>
      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">{t('emergency.triageTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('emergency.triageBody')}
          </Text>
        </View>
      </Card>

      <View
        style={{
          flex: 1,
          minHeight: 200,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: theme.colors.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.xs,
          padding: theme.spacing.lg,
        }}
      >
        <Text variant="body" tone="muted" align="center">
          {t('emergency.cameraPreview')}
        </Text>
        <Text variant="caption" tone="subtle" align="center">
          {t('emergency.cameraAim')}
        </Text>
        <Text
          variant="caption"
          tone="warning"
          align="center"
          style={{ marginTop: theme.spacing.sm }}
        >
          {t('emergency.triageUnavailable')}
        </Text>
      </View>

      <Button
        testID="emergency-triage-skip"
        label={t('emergency.triageSkip')}
        variant="secondary"
        onPress={goToTracking}
      />
    </Screen>
  );
}
