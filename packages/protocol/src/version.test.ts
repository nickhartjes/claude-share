import { describe, expect, it } from 'vitest';
import { checkVersion } from './version.ts';

describe('checkVersion', () => {
  it('accepts equal versions', () => {
    expect(checkVersion(3, 3)).toEqual({ ok: true });
  });

  it('refuses an older viewer and tells the viewer to update', () => {
    const result = checkVersion(3, 2);
    expect(result).toMatchObject({ ok: false, reason: 'viewer-outdated' });
    expect(result.ok || result.message).toContain('Update your app');
  });

  it('refuses a newer viewer and tells the viewer the host must update', () => {
    const result = checkVersion(3, 4);
    expect(result).toMatchObject({ ok: false, reason: 'host-outdated' });
    expect(result.ok || result.message).toContain('host needs to update');
  });
});
