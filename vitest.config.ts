/**
 * Root-level test config — currently just tests/rls.spec.ts.
 *
 * The RLS suite lives at the repo root rather than inside an app because it is
 * not testing an app: it exercises the server the way an attacker would, with
 * raw HTTP and a minted JWT. Putting it under apps/mobile would imply the
 * mobile client is what enforces any of this.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
});
