/** Wire protocol version. Host and viewer must use the same version. */
export const PROTOCOL_VERSION = 1;

export type VersionCheck =
  | { ok: true }
  | { ok: false; reason: 'viewer-outdated' | 'host-outdated'; message: string };

/** Decides on the host whether a viewer speaking `viewerVersion` may join. */
export function checkVersion(hostVersion: number, viewerVersion: number): VersionCheck {
  if (viewerVersion === hostVersion) return { ok: true };
  if (viewerVersion < hostVersion) {
    return {
      ok: false,
      reason: 'viewer-outdated',
      message: `Your app uses protocol version ${viewerVersion} but the host uses ${hostVersion}. Update your app to join.`,
    };
  }
  return {
    ok: false,
    reason: 'host-outdated',
    message: `Your app uses protocol version ${viewerVersion} but the host uses ${hostVersion}. The host needs to update their app.`,
  };
}
