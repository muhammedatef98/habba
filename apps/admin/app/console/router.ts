/**
 * Where the operator is, kept in the URL hash.
 *
 * `#/orders/<id>` rather than component state, so an order can be linked in a
 * handover note or a chat with a colleague, the browser's back button works,
 * and a reload lands where it was. The hash, not the path: the console is one
 * page behind one sign-in gate, and a path would mean a server route per
 * screen for no gain.
 */

'use client';

import { useEffect, useState } from 'react';

export type Section =
  | 'dashboard'
  | 'board'
  | 'orders'
  | 'disputes'
  | 'users'
  | 'providers'
  | 'vehicles'
  | 'ratings'
  | 'finance'
  | 'catalogue'
  | 'notifications'
  | 'settings'
  | 'compliance'
  | 'legal'
  | 'staff'
  | 'audit';

const SECTIONS: readonly Section[] = [
  'dashboard',
  'board',
  'orders',
  'disputes',
  'users',
  'providers',
  'vehicles',
  'ratings',
  'finance',
  'catalogue',
  'notifications',
  'settings',
  'compliance',
  'legal',
  'staff',
  'audit',
];

export interface Route {
  readonly section: Section;
  readonly id: string | null;
}

export function parseHash(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/');
  const section = SECTIONS.find((candidate) => candidate === first) ?? 'dashboard';
  const id = second !== undefined && second !== '' ? decodeURIComponent(second) : null;
  return { section, id };
}

export function hrefFor(section: Section, id?: string | null): string {
  return id === undefined || id === null
    ? `#/${section}`
    : `#/${section}/${encodeURIComponent(id)}`;
}

export function go(section: Section, id?: string | null): void {
  window.location.hash = hrefFor(section, id);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>({ section: 'dashboard', id: null });

  useEffect(() => {
    const update = () => setRoute(parseHash(window.location.hash));
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  return route;
}
