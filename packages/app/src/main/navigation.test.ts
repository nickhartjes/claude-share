import { describe, expect, it, vi } from 'vitest';
import { handleWindowOpen, isAppPage } from './navigation';

describe('handleWindowOpen', () => {
  it.each(['https://example.com/docs', 'http://localhost:3000/', 'mailto:team@example.com'])(
    'opens %s in the system browser and no app window',
    (url) => {
      const openExternal = vi.fn();
      expect(handleWindowOpen(url, openExternal)).toEqual({ action: 'deny' });
      expect(openExternal).toHaveBeenCalledWith(url);
    },
  );

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'smb://server/share'])('refuses %s', (url) => {
    const openExternal = vi.fn();
    expect(handleWindowOpen(url, openExternal)).toEqual({ action: 'deny' });
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('isAppPage', () => {
  it('allows reloading the bundled page or the dev server', () => {
    expect(isAppPage('file:///app/out/renderer/index.html', 'file:///app/out/renderer/index.html')).toBe(true);
    expect(isAppPage('http://localhost:5173/?x=1', 'http://localhost:5173/')).toBe(true);
  });

  it('refuses any other page', () => {
    expect(isAppPage('https://example.com/', 'file:///app/out/renderer/index.html')).toBe(false);
    expect(isAppPage('file:///etc/passwd', 'file:///app/out/renderer/index.html')).toBe(false);
    expect(isAppPage('http://localhost:5174/', 'http://localhost:5173/')).toBe(false);
  });
});
