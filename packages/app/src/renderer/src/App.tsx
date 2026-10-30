import type { Recording } from '@claude-share/protocol';
import { useState } from 'react';
import type { AppSettings, Bridge } from '../../shared/bridge';
import { DisplaySettingsProvider, useAppSettings } from './display-settings';
import { HostScreen } from './screens/HostScreen';
import { RecordingsScreen, ReplayScreen } from './screens/RecordingsScreen';
import { StartScreen } from './screens/StartScreen';
import { ViewerScreen } from './screens/ViewerScreen';

type Screen =
  | { name: 'start'; error?: string }
  | { name: 'host'; mode: { start: string } | { resume: true } }
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
  const toStart = (error?: string) => setScreen(error ? { name: 'start', error } : { name: 'start' });

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
          onJoin={(code) =>
            settings.signallingUrl
              ? setScreen({ name: 'viewer', code })
              : toStart('Joining needs the sharing service, which is not configured in this build.')
          }
          onRecordings={() => setScreen({ name: 'recordings' })}
          error={screen.error}
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
          onFailed={(message) => toStart(message)}
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
