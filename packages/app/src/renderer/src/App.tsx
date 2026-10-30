import type { Recording } from '@specdeck/protocol';
import type { FailureReason } from '@specdeck/protocol/viewer';
import { useState } from 'react';
import type { AppSettings, Bridge, UpdatesApi, UpdateStatus } from '../../shared/bridge';
import { DisplaySettingsProvider, useAppSettings } from './display-settings';
import { HostScreen } from './screens/HostScreen';
import { RecordingsScreen, ReplayScreen } from './screens/RecordingsScreen';
import { StartScreen } from './screens/StartScreen';
import { ViewerScreen } from './screens/ViewerScreen';
import { UpdateNotice, useUpdateStatus } from './updates';

type Screen =
  | { name: 'start'; error?: string; reason?: FailureReason }
  | { name: 'host'; mode: { start: string; recent?: boolean } | { resume: true } }
  | { name: 'viewer'; code: string }
  | { name: 'recordings' }
  | { name: 'replay'; recording: Recording };

export function App({ bridge }: { bridge: Bridge }) {
  const { settings, setSettings, updateDisplay } = useAppSettings(bridge);
  if (!settings) return null;
  return (
    <DisplaySettingsProvider value={{ display: settings, updateDisplay }}>
      <Screens bridge={bridge} settings={settings} setSettings={setSettings} />
    </DisplaySettingsProvider>
  );
}

function Screens({ bridge, settings, setSettings }: { bridge: Bridge; settings: AppSettings; setSettings(settings: AppSettings): void }) {
  // On start, reattach to a session that is still running (the window was closed, or the app restarted).
  const [screen, setScreen] = useState<Screen>({ name: 'host', mode: { resume: true } });
  const update = useUpdateStatus(bridge.updates);
  const toStart = (error?: string, reason?: FailureReason) => {
    setScreen(error ? { name: 'start', error, ...(reason ? { reason } : {}) } : { name: 'start' });
    // Out of date and no newer version known yet: look now, so the error can offer it.
    if (reason === 'viewer-outdated' && update.kind === 'none' && update.mode === 'install') void bridge.updates.check();
  };

  switch (screen.name) {
    case 'start':
      return (
        <StartScreen
          username={settings.username}
          onSaveUsername={async (username) => {
            await bridge.setUsername(username);
            setSettings({ ...settings, username });
          }}
          chooseDirectory={() => bridge.chooseDirectory()}
          onHost={(cwd) => setScreen({ name: 'host', mode: { start: cwd } })}
          recentFolders={settings.recentFolders}
          onHostRecent={(cwd) => setScreen({ name: 'host', mode: { start: cwd, recent: true } })}
          onForgetFolder={(folder) => void bridge.forgetFolder(folder)}
          onJoin={(code) =>
            settings.signallingUrl
              ? setScreen({ name: 'viewer', code })
              : toStart('Joining needs the sharing service, which is not configured in this build.')
          }
          onRecordings={() => setScreen({ name: 'recordings' })}
          error={screen.error}
          errorAction={screen.reason === 'viewer-outdated' ? <UpdateAction status={update} updates={bridge.updates} /> : undefined}
          notice={
            <UpdateNotice
              status={update}
              onRestart={() => void bridge.updates.restart().catch(() => {})}
              onDownload={() => void bridge.updates.openDownload()}
            />
          }
        />
      );
    case 'host':
      return (
        <HostScreen
          key={JSON.stringify(screen.mode)}
          bridge={bridge}
          mode={screen.mode}
          sharingConfigured={Boolean(settings.signallingUrl)}
          // Nothing to reattach to is the normal case at start-up, not an error.
          onFailed={(message) => toStart('resume' in screen.mode ? undefined : message)}
          onEnded={() => toStart()}
        />
      );
    case 'viewer':
      return (
        <ViewerScreen
          signallingUrl={settings.signallingUrl!}
          code={screen.code}
          username={settings.username ?? 'viewer'}
          onFailed={(message, reason) => toStart(message, reason)}
          onLeave={() => toStart()}
        />
      );
    case 'recordings':
      return (
        <RecordingsScreen
          recordings={bridge.recordings}
          onReplay={(recording) => setScreen({ name: 'replay', recording })}
          onBack={() => toStart()}
        />
      );
    case 'replay':
      return <ReplayScreen recording={screen.recording} onBack={() => setScreen({ name: 'recordings' })} />;
  }
}

/**
 * What gets an out-of-date viewer a version that can join (`app-updates`: Offer the update when
 * versions do not match): the downloaded update, or else the download page.
 */
export function UpdateAction({ status, updates }: { status: UpdateStatus; updates: UpdatesApi }) {
  if (status.kind === 'ready' && status.canRestart) {
    return (
      <button className="primary" onClick={() => void updates.restart().catch(() => {})}>
        Restart and update
      </button>
    );
  }
  if (status.kind === 'available' || (status.kind === 'none' && status.mode === 'notify')) {
    return <button onClick={() => void updates.openDownload()}>Download the new version</button>;
  }
  return null;
}
