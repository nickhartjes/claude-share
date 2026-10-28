// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StartScreen, type StartScreenProps } from './StartScreen';

function setup(props: Partial<StartScreenProps> = {}) {
  const handlers = {
    onSaveUsername: vi.fn(async () => {}),
    chooseDirectory: vi.fn(async () => '/work/project' as string | undefined),
    onHost: vi.fn(),
    onJoin: vi.fn(),
    onRecordings: vi.fn(),
  };
  const result = render(<StartScreen username={undefined} {...handlers} {...props} />);
  return { ...handlers, ...result, user: userEvent.setup() };
}

describe('StartScreen', () => {
  it('requires a username before hosting or joining', async () => {
    const { user } = setup();
    expect(screen.getByText('Set a username to host or join a session.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a folder and start' })).toBeDisabled();
    await user.type(screen.getByLabelText('Invite code'), '7K2M9QXH4TPA');
    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();
  });

  it('saves the username, trimmed, and then allows hosting', async () => {
    const { user, onSaveUsername, rerender, ...handlers } = setup();
    await user.type(screen.getByLabelText('Username'), '  nick  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSaveUsername).toHaveBeenCalledWith('nick');
    rerender(<StartScreen username="nick" onSaveUsername={onSaveUsername} {...handlers} />);
    expect(screen.getByText('nick')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a folder and start' })).toBeEnabled();
  });

  it('refuses an empty username', async () => {
    const { user, onSaveUsername } = setup();
    await user.type(screen.getByLabelText('Username'), '   ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a username.')).toBeInTheDocument();
    expect(onSaveUsername).not.toHaveBeenCalled();
  });

  it('hosts in the folder the host chooses', async () => {
    const { user, chooseDirectory, onHost } = setup({ username: 'nick' });
    await user.click(screen.getByRole('button', { name: 'Choose a folder and start' }));
    expect(chooseDirectory).toHaveBeenCalled();
    expect(onHost).toHaveBeenCalledWith('/work/project');
  });

  it('does not host when choosing a folder is cancelled', async () => {
    const { user, onHost } = setup({ username: 'nick', chooseDirectory: vi.fn(async () => undefined) });
    await user.click(screen.getByRole('button', { name: 'Choose a folder and start' }));
    expect(onHost).not.toHaveBeenCalled();
  });

  it('joins with a typed invite code, accepting lower case and dashes', async () => {
    const { user, onJoin } = setup({ username: 'nick' });
    await user.type(screen.getByLabelText('Invite code'), '7k2m-9qxh-4tpa');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(onJoin).toHaveBeenCalledWith('7K2M9QXH4TPA');
  });

  it('explains an invalid invite code without joining', async () => {
    const { user, onJoin } = setup({ username: 'nick' });
    await user.type(screen.getByLabelText('Invite code'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.getByText(/not a valid invite code/)).toBeInTheDocument();
    expect(onJoin).not.toHaveBeenCalled();
  });

  it('shows why the last attempt failed', () => {
    setup({ username: 'nick', error: 'Claude Code was not found.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Claude Code was not found.');
  });
});
