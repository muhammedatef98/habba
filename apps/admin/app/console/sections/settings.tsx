/**
 * Settings: the numbers and switches the platform runs on (0069, 0081, 0093).
 *
 * The meaning and bounds of each setting are fixed in a migration, where they
 * are reviewed; an operator changes the value, within those bounds, and the
 * server refuses anything outside them. "Public" settings are the ones the app
 * reads; the rest (limits, thresholds) never leave the server.
 *
 * Laid out for finding things: the app's switches first, as on/off toggles in
 * a grid; a row of links to each group; a search box. Switching a part of the
 * app off asks first — it disappears from every phone at once.
 */

'use client';

import { useRef, useState } from 'react';
import { api } from '@/data/api';
import type { Setting } from '@/data/types';
import { explain } from '@/data/transport';
import { dateTime } from '@/lib/format';
import { SETTING_CATEGORY } from '../labels';
import { Badge, Button, Loadable, PageHead, Switch, useLoad, useToast } from '../ui';

/** Most-used first: what the app shows, then money, then the machinery. */
const CATEGORY_ORDER = [
  'features',
  'app',
  'payments',
  'dispatch',
  'care',
  'transfer',
  'ops',
  'security',
  'legal',
];

const CATEGORY_NOTE: Readonly<Record<string, string>> = {
  features:
    'كل ميزة تختفي من التطبيق فوراً عند إيقافها، ويرفضها الخادم أيضاً. الطلبات الجارية تكمل.',
  app: 'ما يراه كل المستخدمين: الإعلان، أرقام الدعم، إيقاف الطلبات مؤقتاً، وأقل نسخة مسموحة.',
  payments: 'بوابة الدفع ومدة حجز المبلغ على البطاقة.',
  dispatch: 'كيف يُبحث عن فنّي: النطاق، وعدد الجولات، ومهلة كل جولة.',
  care: 'متى يُذكَّر العميل بالصيانة.',
  transfer: 'مهلة نقل ملكية السيارة وحدود المحاولات.',
  ops: 'متى تنبّهك اللوحة إلى طلب عالق.',
  security: 'حدود رسائل رمز الدخول.',
  legal: 'بيانات الشركة التي تظهر في الشروط وسياسة الخصوصية.',
};

function orderOf(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

export function SettingsSection() {
  const state = useLoad(() => api.settings(), 'settings');
  const [query, setQuery] = useState('');
  const groups = useRef<Record<string, HTMLElement | null>>({});

  return (
    <>
      <PageHead
        title="الإعدادات وتشغيل الميزات"
        description="تشغيل أجزاء التطبيق وإيقافها، وأرقام تشغيل المنصّة. كل تغيير يسري فوراً ويُسجَّل باسمك."
      />
      <Loadable state={state}>
        {(settings) => {
          const needle = query.trim().toLowerCase();
          const shown = settings.filter(
            (setting) =>
              needle === '' ||
              [setting.label_ar, setting.description_ar, setting.key].some((text) =>
                String(text ?? '')
                  .toLowerCase()
                  .includes(needle),
              ),
          );
          const categories = [...new Set(settings.map((setting) => setting.category))].sort(
            (a, b) => orderOf(a) - orderOf(b),
          );
          const offCount = settings.filter(
            (setting) => setting.category === 'features' && setting.value === false,
          ).length;

          return (
            <>
              <div className="jump-nav">
                <input
                  className="input"
                  style={{ maxWidth: 260 }}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ابحث في الإعدادات…"
                />
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className="chip"
                    onClick={() =>
                      groups.current[category]?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      })
                    }
                  >
                    {SETTING_CATEGORY[category] ?? category}
                  </button>
                ))}
              </div>
              {offCount > 0 ? (
                <p className="notice" data-tone="warn">
                  {offCount === 1 ? 'ميزة واحدة متوقفة الآن' : `${offCount} ميزات متوقفة الآن`} في
                  التطبيق.
                </p>
              ) : null}
              <div className="grid">
                {categories.map((category) => {
                  const inGroup = shown.filter((setting) => setting.category === category);
                  if (inGroup.length === 0) return null;
                  return (
                    <section
                      key={category}
                      className="card"
                      ref={(element) => {
                        groups.current[category] = element;
                      }}
                      style={{ scrollMarginTop: 72 }}
                    >
                      <h2 style={{ marginTop: 0 }}>{SETTING_CATEGORY[category] ?? category}</h2>
                      {CATEGORY_NOTE[category] !== undefined ? (
                        <p className="subtle" style={{ marginTop: 0 }}>
                          {CATEGORY_NOTE[category]}
                        </p>
                      ) : null}
                      <div className="settings-grid">
                        {inGroup.map((setting) => (
                          <SettingTile key={setting.key} setting={setting} onSaved={state.reload} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
              {shown.length === 0 ? <p className="subtle">لا إعدادات تطابق البحث.</p> : null}
            </>
          );
        }}
      </Loadable>
    </>
  );
}

function SettingTile({
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
      setValue(initial);
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  const bounds =
    setting.min_value !== null || setting.max_value !== null
      ? `من ${setting.min_value ?? '—'} إلى ${setting.max_value ?? '—'}`
      : null;

  // The pause switch is the one whose "on" stops the business; everything
  // else in features stops a part of it when off.
  const isPause = setting.key === 'new_orders_paused';
  const isFeature = setting.category === 'features';

  const toggle = (next: boolean) => {
    const question = isPause
      ? next
        ? 'إيقاف استقبال كل الطلبات الجديدة الآن؟'
        : null
      : isFeature && !next
        ? `إيقاف «${setting.label_ar}»؟ يختفي من التطبيق عند كل المستخدمين فوراً.`
        : null;
    if (question !== null && !window.confirm(question)) return;
    setValue(next);
    void save(next);
  };

  return (
    <div
      className="setting-tile"
      data-off={setting.value_type === 'boolean' && (isPause ? value === true : value === false)}
    >
      <div className="actions" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>{setting.label_ar}</strong>
        {setting.is_public && !isFeature ? <Badge tone="info">يقرؤه التطبيق</Badge> : null}
      </div>
      {setting.description_ar !== null ? (
        <span className="subtle">{setting.description_ar}</span>
      ) : null}

      {setting.value_type === 'boolean' ? (
        <Switch
          label={setting.label_ar}
          checked={value === true}
          busy={busy}
          onChange={toggle}
          onText={isPause ? 'الطلبات الجديدة متوقفة' : 'يعمل'}
          offText={isPause ? 'الطلبات تُستقبل' : 'متوقف'}
        />
      ) : (
        <div className="actions" style={{ alignItems: 'center' }}>
          {setting.value_type === 'text' && String(value).length > 40 ? (
            <textarea
              className="input"
              rows={3}
              value={String(value)}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : (
            <input
              className={`input${setting.value_type === 'text' ? '' : ' numeric'}`}
              style={{ maxWidth: setting.value_type === 'text' ? undefined : 140, flex: 1 }}
              inputMode={setting.value_type === 'text' ? undefined : 'decimal'}
              dir={/url|email|phone|whatsapp|version/.test(setting.key) ? 'ltr' : undefined}
              value={String(value)}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && dirty) void save(value);
              }}
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
          {dirty ? (
            <Button size="small" onClick={() => setValue(initial)}>
              تراجع
            </Button>
          ) : null}
        </div>
      )}
      <span className="subtle" style={{ fontSize: 'var(--text-xs)' }}>
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
