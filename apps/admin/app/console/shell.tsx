/**
 * The console around every section: where you are, who you are, and a
 * search that finds anything from anywhere.
 */

'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/data/api';
import type { Dashboard, SearchHit } from '@/data/types';
import { dateTime } from '@/lib/format';
import type { Operator } from '@/lib/ops-session';
import { go, hrefFor, useRoute, type Section } from './router';
import { Badge, ToastProvider } from './ui';
import { DashboardSection } from './sections/dashboard';
import { BoardSection } from './sections/board';
import { OrdersSection } from './sections/orders';
import { DisputesSection } from './sections/disputes';
import { UsersSection } from './sections/users';
import { ProvidersSection } from './sections/providers';
import { VehiclesSection } from './sections/vehicles';
import { RatingsSection } from './sections/ratings';
import { FinanceSection } from './sections/finance';
import { CatalogueSection } from './sections/catalogue';
import { NotificationsSection } from './sections/notifications';
import { SettingsSection } from './sections/settings';
import { ComplianceSection } from './sections/compliance';
import { LegalSection } from './sections/legal';
import { StaffSection } from './sections/staff';
import { AuditSection } from './sections/audit';

const OperatorContext = createContext<Operator | null>(null);

/** The signed-in operator, for the few screens that show super-admin controls. */
export function useOperator(): Operator {
  const operator = useContext(OperatorContext);
  if (operator === null) throw new Error('useOperator outside the console');
  return operator;
}

type CountKey = 'disputes_open' | 'pending_verifications' | 'pending_payment_operations';

const NAV: readonly {
  readonly group: string;
  readonly items: readonly {
    readonly section: Section;
    readonly label: string;
    readonly count?: CountKey;
  }[];
}[] = [
  {
    group: 'نظرة عامة',
    items: [
      { section: 'dashboard', label: 'الرئيسية' },
      { section: 'board', label: 'اللوحة الحية' },
    ],
  },
  {
    group: 'العمليات',
    items: [
      { section: 'orders', label: 'الطلبات' },
      { section: 'disputes', label: 'الشكاوى', count: 'disputes_open' },
      { section: 'providers', label: 'مقدّمو الخدمة', count: 'pending_verifications' },
      { section: 'users', label: 'المستخدمون' },
      { section: 'vehicles', label: 'المركبات والدفتر' },
      { section: 'ratings', label: 'التقييمات' },
    ],
  },
  {
    group: 'المال',
    items: [{ section: 'finance', label: 'المالية', count: 'pending_payment_operations' }],
  },
  {
    group: 'المنصّة',
    items: [
      { section: 'catalogue', label: 'الكتالوج' },
      { section: 'notifications', label: 'الإشعارات' },
      { section: 'settings', label: 'الإعدادات' },
    ],
  },
  {
    group: 'الحوكمة',
    items: [
      { section: 'compliance', label: 'الخصوصية والامتثال' },
      { section: 'legal', label: 'الشروط والسياسات' },
      { section: 'staff', label: 'الفريق' },
      { section: 'audit', label: 'سجلّ التدقيق' },
    ],
  },
];

export function Shell({
  operator,
  onSignOut,
}: {
  readonly operator: Operator;
  readonly onSignOut: () => void;
}) {
  const route = useRoute();
  const [counts, setCounts] = useState<Dashboard | null>(null);

  // The sidebar's counts follow the operator around: whatever they just did
  // in one section may have changed another's queue.
  useEffect(() => {
    let live = true;
    api
      .dashboard()
      .then((dashboard) => {
        if (live) setCounts(dashboard);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [route.section, route.id]);

  return (
    <OperatorContext.Provider value={operator}>
      <ToastProvider>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              هبّة
              <small>لوحة التشغيل</small>
            </div>
            <nav className="nav" aria-label="الأقسام">
              {NAV.map((group) => (
                <div key={group.group} style={{ display: 'contents' }}>
                  <div className="nav-group">{group.group}</div>
                  {group.items.map((item) => {
                    const count =
                      item.count !== undefined && counts !== null ? counts[item.count] : 0;
                    return (
                      <a
                        key={item.section}
                        href={hrefFor(item.section)}
                        className="nav-item"
                        aria-current={route.section === item.section ? 'page' : undefined}
                        style={{ textDecoration: 'none' }}
                      >
                        {item.label}
                        {count > 0 ? <span className="nav-count">{count}</span> : null}
                      </a>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>

          <main className="main">
            <div className="topbar">
              <GlobalSearch />
              <div className="operator">
                {/* Named, because every action here is recorded against this
                    person and they should see whose name is on it. */}
                <strong>{operator.fullName}</strong>
                <Badge tone={operator.role === 'super_admin' ? 'brand' : 'neutral'}>
                  {operator.role === 'super_admin' ? 'مشرف عام' : 'مشغّل'}
                </Badge>
                <span className="subtle">
                  تنتهي الجلسة {dateTime(operator.expiresAt.toISOString())}
                </span>
                <button className="link" onClick={onSignOut}>
                  تسجيل الخروج
                </button>
              </div>
            </div>

            {counts?.new_orders_paused === true ? (
              <p className="notice" data-tone="bad">
                استقبال الطلبات الجديدة متوقف الآن.{' '}
                <a className="link" href={hrefFor('settings')}>
                  الإعدادات
                </a>
              </p>
            ) : null}

            <SectionView section={route.section} id={route.id} />
          </main>
        </div>
      </ToastProvider>
    </OperatorContext.Provider>
  );
}

function SectionView({ section, id }: { readonly section: Section; readonly id: string | null }) {
  switch (section) {
    case 'dashboard':
      return <DashboardSection />;
    case 'board':
      return <BoardSection />;
    case 'orders':
      return <OrdersSection id={id} />;
    case 'disputes':
      return <DisputesSection />;
    case 'users':
      return <UsersSection id={id} />;
    case 'providers':
      return <ProvidersSection id={id} />;
    case 'vehicles':
      return <VehiclesSection id={id} />;
    case 'ratings':
      return <RatingsSection />;
    case 'finance':
      return <FinanceSection />;
    case 'catalogue':
      return <CatalogueSection />;
    case 'notifications':
      return <NotificationsSection />;
    case 'settings':
      return <SettingsSection />;
    case 'compliance':
      return <ComplianceSection />;
    case 'legal':
      return <LegalSection />;
    case 'staff':
      return <StaffSection />;
    case 'audit':
      return <AuditSection />;
  }
}

const KIND: Readonly<Record<SearchHit['kind'], { label: string; section: Section }>> = {
  order: { label: 'طلب', section: 'orders' },
  user: { label: 'مستخدم', section: 'users' },
  vehicle: { label: 'سيارة', section: 'vehicles' },
  provider: { label: 'مقدّم خدمة', section: 'providers' },
};

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .search(trimmed)
        .then((result) => {
          if (live) setHits(result);
        })
        .catch(() => {
          if (live) setHits([]);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="search" ref={box}>
      <input
        className="input"
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="ابحث برقم الطلب، الجوال، الاسم، اللوحة، رقم الهيكل، أو السجل التجاري"
        aria-label="بحث"
      />
      {open && query.trim().length >= 2 ? (
        <div className="search-results">
          {hits.length === 0 ? (
            <p className="muted" style={{ padding: 'var(--space-md)', margin: 0 }}>
              لا نتائج.
            </p>
          ) : (
            hits.map((hit) => (
              <button
                key={`${hit.kind}-${hit.id}`}
                className="search-hit"
                onClick={() => {
                  setOpen(false);
                  setQuery('');
                  go(KIND[hit.kind].section, hit.id);
                }}
              >
                <Badge tone="brand">{KIND[hit.kind].label}</Badge>
                <span>
                  <strong>{hit.title}</strong>
                  <span className="subtle"> · {hit.subtitle}</span>
                </span>
                {hit.status === 'suspended' ? <Badge tone="bad">موقوف</Badge> : <span />}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
