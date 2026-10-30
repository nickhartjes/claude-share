import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_DISPLAY_SETTINGS, type AppSettings, type Bridge, type DisplaySettings } from '../../shared/bridge';

export interface DisplaySettingsValue {
  display: DisplaySettings;
  /** Applies at once; stored in the background. A refused update is rolled back. */
  updateDisplay(update: Partial<DisplaySettings>): void;
}

const DisplaySettingsContext = createContext<DisplaySettingsValue>({
  display: DEFAULT_DISPLAY_SETTINGS,
  updateDisplay: () => {},
});

/** Display settings for screens below a DisplaySettingsProvider; defaults without one. */
export function useDisplaySettings(): DisplaySettingsValue {
  return useContext(DisplaySettingsContext);
}

export function DisplaySettingsProvider({ value, children }: { value: DisplaySettingsValue; children: ReactNode }) {
  return <DisplaySettingsContext.Provider value={value}>{children}</DisplaySettingsContext.Provider>;
}

/** Same merge as the main process: pane layouts merge per mode, everything else replaces. */
function merge<T extends DisplaySettings>(settings: T, update: Partial<DisplaySettings>): T {
  return { ...settings, ...update, ...(update.panes ? { panes: { ...settings.panes, ...update.panes } } : {}) };
}

/**
 * All settings for the app: read once, kept in sync with changes from the main process, and
 * updated optimistically so a toggle or a pane drag responds without waiting for the file write.
 */
export function useAppSettings(bridge: Bridge) {
  const [settings, setSettings] = useState<AppSettings | undefined>();
  // The last settings the main process confirmed, to roll back to when an update is refused.
  const confirmed = useRef<AppSettings | undefined>(undefined);
  // While updates are in flight, confirmations of earlier ones would undo later optimistic
  // changes (a pane jumping back while dragged): show them only once nothing is pending.
  const pending = useRef(0);

  useEffect(() => {
    const accept = (next: AppSettings) => {
      confirmed.current = next;
      if (pending.current === 0) setSettings(next);
    };
    const unsubscribe = bridge.onSettingsChanged(accept);
    void bridge.getSettings().then(accept);
    return unsubscribe;
  }, [bridge]);

  const updateDisplay = useCallback(
    (update: Partial<DisplaySettings>) => {
      pending.current++;
      setSettings((current) => current && merge(current, update));
      const settle = (refused: boolean) => {
        pending.current--;
        if (pending.current === 0 || refused) setSettings(confirmed.current);
      };
      bridge.updateSettings(update).then(
        (next) => {
          confirmed.current = next;
          settle(false);
        },
        () => settle(true),
      );
    },
    [bridge],
  );

  return { settings, setSettings, updateDisplay };
}
