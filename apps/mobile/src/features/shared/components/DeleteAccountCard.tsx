/**
 * «حذف الحساب» — the person erases their own account (0086), as the App Store
 * requires and the PDPL entitles them to.
 *
 * Two deliberate steps: open the card, then type «حذف» (or DELETE) before the
 * button works. It says plainly what goes and what stays — the car's logbook
 * stays with the car, invoices stay because the law keeps them — and, when
 * the server refuses, why and what to do instead.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useSession } from '@/features/shared/state/session';

const CONFIRM_WORDS = ['حذف', 'delete'];

const REFUSAL_KEY: Readonly<Record<string, string>> = {
  open_order: 'settings.deleteAccount.openOrder',
  pending_payout: 'settings.deleteAccount.pendingPayout',
  staff_account: 'settings.deleteAccount.staffAccount',
};

export function DeleteAccountCard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const signOut = useSession((state) => state.signOut);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const erase = useMutation({
    mutationFn: () => repository.deleteMyAccount(),
    // Explained on the card, in words the person can act on.
    meta: { inlineError: true },
    onSuccess: () => {
      queryClient.clear();
      signOut();
      router.replace('/');
    },
  });

  if (!open) {
    // Quieter than «تسجيل الخروج» above it: found by someone looking for it,
    // not tapped by someone reaching for sign-out.
    return (
      <Pressable
        testID="delete-account-open"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={({ pressed }) => [
          { alignSelf: 'center', paddingVertical: theme.spacing.sm },
          pressed ? { opacity: 0.6 } : null,
        ]}
      >
        <Text variant="bodySmall" tone="emergency">
          {t('settings.deleteAccount.open')}
        </Text>
      </Pressable>
    );
  }

  const confirmed = CONFIRM_WORDS.includes(typed.trim().toLowerCase());
  const refusal = erase.error instanceof Error ? (REFUSAL_KEY[erase.error.message] ?? null) : null;

  return (
    <Card
      testID="delete-account-card"
      elevation="sm"
      style={{
        gap: theme.spacing.md,
        backgroundColor: theme.colors.emergencySubtle,
        borderColor: theme.colors.emergencyBorder,
        borderWidth: 1,
      }}
    >
      <Text variant="bodyStrong" tone="emergency">
        {t('settings.deleteAccount.title')}
      </Text>
      <View style={{ gap: theme.spacing.xs }}>
        {(['gone', 'kept', 'final'] as const).map((line) => (
          <Text key={line} variant="bodySmall" tone="muted">
            • {t(`settings.deleteAccount.${line}`)}
          </Text>
        ))}
      </View>
      <Field
        testID="delete-account-confirm-input"
        label={t('settings.deleteAccount.typeToConfirm')}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {erase.isError ? (
        <Text variant="bodySmall" tone="emergency">
          {refusal !== null ? t(refusal) : t('settings.deleteAccount.failed')}
        </Text>
      ) : null}
      <Button
        testID="delete-account-do"
        label={t('settings.deleteAccount.confirm')}
        variant="emergency"
        size="medium"
        disabled={!confirmed}
        loading={erase.isPending}
        onPress={() => erase.mutate()}
      />
      <Button
        testID="delete-account-cancel"
        label={t('common.cancel')}
        variant="ghost"
        size="medium"
        onPress={() => {
          setOpen(false);
          setTyped('');
          erase.reset();
        }}
      />
    </Card>
  );
}
