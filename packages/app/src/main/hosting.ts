import type { StartResult } from '../shared/bridge';
import type { HostController } from './host-controller';
import type { Settings } from './settings';

type Size = { cols: number; rows: number };

export interface Hosting {
  /** Starts a session in a folder the host chose in the folder dialog. */
  start(cwd: string, size: Size): Promise<StartResult>;
  /** Starts a session in one of the recent folders; any other path is refused. */
  startRecent(cwd: string, size: Size): Promise<StartResult>;
}

/**
 * Starting a session, and remembering the folder once it has started (`session-hosting`: Recent
 * working folders). `changed` runs after the recent folders change, to tell the windows.
 */
export function hosting(host: Pick<HostController, 'start'>, settings: Settings, changed: () => void): Hosting {
  const start = async (cwd: string, size: Size) => {
    const result = await host.start(cwd, size);
    if (result.ok) {
      await settings.addRecentFolder(cwd);
      changed();
    }
    return result;
  };
  return {
    start,
    // The window can name any path; only one the host picked before in the dialog may start without it.
    startRecent: async (cwd, size) => {
      const folder = await settings.recentFolder(cwd);
      if (!folder) return { ok: false, message: 'That folder is not one of your recent folders. Choose it with the folder dialog.' };
      return start(folder, size);
    },
  };
}
