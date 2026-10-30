// What the app window may open. Session content (replies, terminal output) comes from another
// machine, so links in it must never load inside the app: they go to the system browser.

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** For `setWindowOpenHandler`: never open an app window; hand web and mail links to `openExternal`. */
export function handleWindowOpen(url: string, openExternal: (url: string) => void): { action: 'deny' } {
  try {
    if (EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) openExternal(url);
  } catch {
    // Not a URL: ignore it.
  }
  return { action: 'deny' };
}

/** For `will-navigate`: the window may only reload its own page (the dev server or the bundled file). */
export function isAppPage(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url);
    const app = new URL(appUrl);
    return target.protocol === app.protocol && target.host === app.host && target.pathname === app.pathname;
  } catch {
    return false;
  }
}
