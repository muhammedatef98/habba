/**
 * Root layout for the ops console.
 *
 * Arabic and RTL like every other surface (§2.1). Ops read the same order
 * records the customer does; translating them for staff would put a second
 * version of the truth on screen and make every support conversation a
 * reconciliation.
 */

import type { Metadata } from 'next';
import { themeStylesheet } from '@/lib/theme.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'هبّة — لوحة التشغيل',
  description: 'مراجعة مقدّمي الخدمة والطلبات',
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Injected rather than imported as CSS: the values come from
            @habba/ui/tokens, so there is exactly one palette in the repo. */}
        <style dangerouslySetInnerHTML={{ __html: themeStylesheet() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
