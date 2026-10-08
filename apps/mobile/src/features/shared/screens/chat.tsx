/**
 * Messages between a customer and the technician on their order (0101).
 *
 * A customer waiting in an underground car park needs to say which level
 * the car is on; a technician running late needs to say so. Before this the
 * only channel was a phone number neither side had, and handing out personal
 * numbers is a privacy decision nobody has made. So the thread lives on the
 * order: it opens at acceptance, closes at hand-back, and both sides read it
 * through the same RLS as the order itself.
 *
 * Shared by both sides. `side` only chooses the quick replies offered; the
 * server decides who is writing from the order, not from this param.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  EmptyState,
  ErrorState,
  Row,
  Screen,
  Skeleton,
  Text,
  arabicFace,
  useTheme,
} from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import type { OrderMessage, OrderMessageRefusal } from '@/features/shared/data/types';
import { BackBar } from '@/features/shared/components/BackBar';
import { useLiveRefresh } from '@/features/shared/lib/live';
import { CHAT_MAX_LENGTH, refusalOf, sideOf } from '@/features/shared/lib/chat';

const QUICK_REPLIES: Record<OrderMessage['side'], readonly string[]> = {
  provider: ['chat.quick.onMyWay', 'chat.quick.whereExactly', 'chat.quick.runningLate'],
  customer: ['chat.quick.underground', 'chat.quick.besideCar', 'chat.quick.tellOnArrival'],
};

function timeOf(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-SA', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ChatScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; side?: string }>();
  const orderId = typeof params.id === 'string' ? params.id : undefined;
  const side = sideOf(params.side);
  const [draft, setDraft] = useState('');
  const [refusal, setRefusal] = useState<OrderMessageRefusal | 'network' | null>(null);
  const scroll = useRef<ScrollView>(null);

  const key = ['order-messages', orderId] as const;
  const messages = useQuery({
    queryKey: key,
    queryFn: () => repository.listOrderMessages(orderId ?? ''),
    enabled: orderId !== undefined,
    // Realtime is the fast path; this is the fallback for a dropped socket.
    refetchInterval: 15_000,
  });

  useLiveRefresh(
    [{ table: 'order_messages', filter: `order_id=eq.${orderId ?? ''}` }],
    [key],
    orderId !== undefined,
  );

  const send = useMutation({
    mutationFn: (body: string) => repository.sendOrderMessage(orderId ?? '', body, side),
    meta: { inlineError: true },
    onMutate: () => setRefusal(null),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (cause) => setRefusal(refusalOf(cause) ?? 'network'),
  });

  const count = messages.data?.length ?? 0;
  useEffect(() => {
    if (count > 0) scroll.current?.scrollToEnd({ animated: true });
  }, [count]);

  const closed = refusal === 'closed' || refusal === 'not_party';
  const body = draft.trim();
  const submit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || send.isPending || closed) return;
    send.mutate(trimmed);
  };

  return (
    <Screen testID="chat-screen" style={{ gap: theme.spacing.md }}>
      <BackBar label={t(side === 'provider' ? 'chat.titleProvider' : 'chat.titleCustomer')} />

      <View style={{ flex: 1 }}>
        {messages.isLoading ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Skeleton height={44} width="60%" />
            <Skeleton height={44} width="45%" />
          </View>
        ) : messages.isError && messages.data === undefined ? (
          <ErrorState
            message={t('chat.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={() => void messages.refetch()}
          />
        ) : count === 0 ? (
          <EmptyState iconName="chat" title={t('chat.emptyTitle')} body={t('chat.emptyBody')} />
        ) : (
          <ScrollView
            ref={scroll}
            testID="chat-thread"
            contentContainerStyle={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.xs }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {(messages.data ?? []).map((message) => (
              // Mine at the end side, as every messaging app puts it: the left
              // in Arabic, the right in English. Row mirrors it.
              <Row key={message.id} justify={message.mine ? 'flex-end' : 'flex-start'}>
                <View
                  testID={message.mine ? 'chat-mine' : 'chat-theirs'}
                  style={{
                    maxWidth: '80%',
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.lg,
                    backgroundColor: message.mine
                      ? theme.colors.primary
                      : theme.colors.surfaceSunken,
                    gap: 2,
                  }}
                >
                  <Text variant="body" tone={message.mine ? 'inverse' : 'default'}>
                    {message.body}
                  </Text>
                  <Text
                    variant="caption"
                    tone={message.mine ? 'inverse' : 'subtle'}
                    style={{ fontSize: theme.fontSize.xs, opacity: message.mine ? 0.8 : 1 }}
                  >
                    {timeOf(message.createdAt, i18n.language)}
                  </Text>
                </View>
              </Row>
            ))}
          </ScrollView>
        )}
      </View>

      {closed ? (
        <Text variant="caption" tone="muted" testID="chat-closed" style={{ textAlign: 'center' }}>
          {t('chat.closed')}
        </Text>
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {refusal !== null ? (
            <Text variant="caption" tone="emergency" testID="chat-error">
              {t(`chat.error.${refusal}`)}
            </Text>
          ) : null}

          <Row gap="xs" wrap>
            {QUICK_REPLIES[side].map((replyKey) => (
              <Pressable
                key={replyKey}
                testID={`chat-quick-${replyKey.split('.').pop() ?? ''}`}
                accessibilityRole="button"
                disabled={send.isPending}
                onPress={() => submit(t(replyKey))}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.xs,
                  borderRadius: theme.radius.full,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text variant="caption">{t(replyKey)}</Text>
              </Pressable>
            ))}
          </Row>

          <Row gap="sm" align="flex-end">
            <TextInput
              testID="chat-input"
              value={draft}
              onChangeText={setDraft}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={theme.colors.textSubtle}
              accessibilityLabel={t('chat.placeholder')}
              multiline
              maxLength={CHAT_MAX_LENGTH}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: theme.minTouchTarget,
                maxHeight: 120,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                color: theme.colors.text,
                fontSize: theme.fontSize.base,
                fontFamily: arabicFace['400'],
                textAlign: theme.isRtl ? 'right' : 'left',
                writingDirection: theme.direction,
              }}
            />
            <Button
              testID="chat-send"
              label={t('chat.send')}
              size="medium"
              loading={send.isPending}
              disabled={body.length === 0}
              onPress={() => submit(draft)}
            />
          </Row>
        </View>
      )}
    </Screen>
  );
}
