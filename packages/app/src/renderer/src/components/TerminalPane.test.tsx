// @vitest-environment jsdom
import { Terminal } from '@xterm/xterm';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush } from '../test-support';
import { TerminalPane, type TerminalController } from './TerminalPane';

// jsdom lacks these browser APIs that xterm.js and the host terminal use.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

async function renderViewer() {
  let controller: TerminalController | undefined;
  const onInput = vi.fn();
  render(<TerminalPane interactive={false} onReady={(c) => (controller = c)} onInput={onInput} />);
  await act(flush);
  return { controller: controller!, onInput, user: userEvent.setup() };
}

describe('TerminalPane (viewer)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('follows the live output, offers to return after a jump, and flags new output meanwhile', async () => {
    const { controller, user } = await renderViewer();
    await act(() => controller.load('', -1));
    for (let i = 0; i < 5; i++) await act(() => controller.write(`line ${i}\r\n`, i));
    expect(screen.getByText('Following live')).toBeInTheDocument();

    act(() => controller.jumpTo(1));
    expect(screen.getByRole('button', { name: 'Follow live' })).toBeInTheDocument();
    await act(() => controller.write('more\r\n', 5));
    expect(screen.getByRole('button', { name: 'New output · follow live' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New output · follow live' }));
    expect(screen.getByText('Following live')).toBeInTheDocument();
  });

  it('searches the whole session and steps through matches', async () => {
    const { controller, user } = await renderViewer();
    await act(() => controller.load('', -1));
    for (let i = 0; i < 50; i++) await act(() => controller.write(i % 10 === 0 ? `needle ${i}\r\n` : `hay ${i}\r\n`, i));
    await user.type(screen.getByLabelText('Search the terminal'), 'needle{Enter}');
    await waitFor(() => expect(screen.getByText('1 of 5')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Next match' }));
    await waitFor(() => expect(screen.getByText('2 of 5')).toBeInTheDocument());
    // Searching moves away from the live end.
    expect(screen.getByRole('button', { name: 'Follow live' })).toBeInTheDocument();
  });

  it('says when nothing matches', async () => {
    const { controller, user } = await renderViewer();
    await act(() => controller.write('nothing here\r\n', 0));
    await user.type(screen.getByLabelText('Search the terminal'), 'absent{Enter}');
    await waitFor(() => expect(screen.getByText('No matches')).toBeInTheDocument());
  });

  it('copies the selected text to the clipboard', async () => {
    const { user } = await renderViewer();
    vi.spyOn(Terminal.prototype, 'getSelection').mockReturnValue('selected output');
    await user.click(screen.getByRole('button', { name: 'Copy selection' }));
    expect(await navigator.clipboard.readText()).toBe('selected output');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('sends nothing when a viewer types into the terminal', async () => {
    const { onInput, user } = await renderViewer();
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      await user.keyboard('rm -rf /{Enter}');
    }
    expect(onInput).not.toHaveBeenCalled();
  });
});
