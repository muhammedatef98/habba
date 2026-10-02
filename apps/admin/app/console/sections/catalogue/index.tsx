/**
 * The catalogue: the services Habba sells and at what price, the cities it
 * works in, the cars it knows, the maintenance schedule it predicts from,
 * the inspection checklists, the commission it takes, the VAT it charges,
 * and who issues its invoices.
 *
 * These tables are open to operators by RLS (and to nobody else for writing),
 * so the editors write them directly; every change lands in the audit log
 * (0068). Services and inspection templates have editors of their own; the
 * rest share one (tables.tsx).
 */

'use client';

import { useState } from 'react';
import { PageHead, Tabs } from '../../ui';
import { ServicesEditor } from './services';
import { TABLE_SPECS, TableEditor } from './tables';
import { TemplatesEditor } from './templates';

const TABS = [
  { value: 'services', label: 'الخدمات والأسعار' },
  { value: 'inspection_templates', label: 'نماذج الفحص' },
  ...TABLE_SPECS.map((spec) => ({ value: spec.table, label: spec.label })),
];

export function CatalogueSection() {
  const [table, setTable] = useState('services');
  const spec = TABLE_SPECS.find((candidate) => candidate.table === table);

  return (
    <>
      <PageHead
        title="الكتالوج"
        description="ما تبيعه هبّة وأين وبكم. اضغط على أي سطر لتعديله، ومفتاح «يعمل / متوقف» يُظهر العنصر في التطبيق أو يخفيه فوراً. كل تعديل يُسجَّل باسمك."
      />
      <Tabs tabs={TABS} value={table} onChange={setTable} />
      {table === 'services' ? (
        <ServicesEditor />
      ) : table === 'inspection_templates' ? (
        <TemplatesEditor />
      ) : spec !== undefined ? (
        <TableEditor key={spec.table} spec={spec} />
      ) : null}
    </>
  );
}
