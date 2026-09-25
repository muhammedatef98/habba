/**
 * Settings: the numbers and switches the platform runs on (0069).
 *
 * The meaning and bounds of each setting are fixed in a migration, where they
 * are reviewed; an operator changes the value, within those bounds, and the
 * server refuses anything outside them. "Public" settings are the ones the app
 * reads; the rest (limits, thresholds) never leave the server.
 */

'use client';

import { useState } from 'react';
import { api } from '@/data/api';
import type { Setting } from '@/data/types';
import { explain } from '@/data/transport';
import { dateTime } from '@/lib/format';
import { SETTING_CATEGORY } from '../labels';
import { Badge, Button, Card, Loadable, PageHead, useLoad, useToast } from '../ui';

export function SettingsSection() {
  const state = useLoad(() => api.settings(), 'settings');

  return (
    <>
      <PageHead
        title="الإعدادات"
        description="تتحكّم في سلوك التطبيق والبحث عن الفنّيين وحدود الأمان. كل تغيير يسري فوراً ويُسجَّل باسمك."
      />
      <Loadable state={state}>
        {(settings) => {
          const categories = [...new Set(settings.map((setting) => setting.category))];
          return (
            <div className="grid">
              {categories.map((category) => (
                <Card key={category} title={SETTING_CATEGORY[category] ?? category}>
                  <div style={{ display: 'grid', gap: 'var(--space-base)' }}>
                    {settings
                      .filter((setting) => setting.category === category)
                      .map((setting) => (
                        <SettingRow key={setting.key} setting={setting} onSaved={state.reload} />
                      ))}
                  </div>
                </Card>
              ))}
            </div>
          );
        }}
      </Loadable>
    </>
  );
}

function SettingRow({
  setting,
  onSaved,
}: {
  readonly setting: Setting;
  readonly onSaved: () => void;
}) {
  const initial =
    setting.value_type === 'boolean' ? setting.value === true : String(setting.value ?? '');
  const [value, setValue] = useState<string | boolean>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const dirty = value !== initial;

  const save = async (next: string | boolean) => {
    setBusy(true);
    setError(null);
    try {
      const parsed =
        setting.value_type === 'boolean'
          ? next === true
          : setting.value_type === 'text'
            ? String(next)
            : Number(next);
      if (typeof parsed === 'number' && !Number.isFinite(parsed))
        throw new Error('القيمة يجب أن تكون رقماً.');
      await api.updateSetting(setting.key, parsed);
      toast('حُفظ الإعداد.');
      onSaved();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  const bounds =
    setting.min_value !== null || setting.max_value !== null
      ? `من ${setting.min_value ?? '—'} إلى ${setting.max_value ?? '—'}`
      : null;

  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--space-xs)',
        paddingBottom: 'var(--space-md)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div className="actions" style={{ alignItems: 'center' }}>
        <strong>{setting.label_ar}</strong>
        {setting.is_public ? <Badge tone="info">يقرؤه التطبيق</Badge> : null}
      </div>
      {setting.description_ar !== null ? (
        <span className="subtle">{setting.description_ar}</span>
      ) : null}
      <div className="actions" style={{ alignItems: 'center' }}>
        {setting.value_type === 'boolean' ? (
          <Button
            tone={value === true ? 'danger' : 'primary'}
            busy={busy}
            onClick={() => {
              const next = !(value === true);
              if (
                setting.key === 'new_orders_paused' &&
                next &&
                !window.confirm('إيقاف استقبال كل الطلبات الجديدة الآن؟')
              ) {
                return;
              }
              setValue(next);
              void save(next);
            }}
          >
            {value === true ? 'مفعّل — اضغط للإيقاف' : 'متوقف — اضغط للتفعيل'}
          </Button>
        ) : (
          <>
            {setting.value_type === 'text' && String(value).length > 60 ? (
              <textarea
                className="input"
                rows={2}
                value={String(value)}
                onChange={(event) => setValue(event.target.value)}
                style={{ maxWidth: 520 }}
              />
            ) : (
              <input
                className={`input${setting.value_type === 'text' ? '' : ' numeric'}`}
                style={{ maxWidth: setting.value_type === 'text' ? 520 : 160 }}
                inputMode={setting.value_type === 'text' ? undefined : 'decimal'}
                value={String(value)}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
            {setting.unit_ar !== null ? <span className="muted">{setting.unit_ar}</span> : null}
            <Button
              tone="primary"
              size="small"
              busy={busy}
              disabled={!dirty}
              onClick={() => void save(value)}
            >
              حفظ
            </Button>
          </>
        )}
      </div>
      <span className="subtle">
        {bounds !== null ? `${bounds} · ` : ''}آخر تعديل {dateTime(setting.updated_at)}
      </span>
      {error !== null ? (
        <p className="notice" data-tone="bad" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
