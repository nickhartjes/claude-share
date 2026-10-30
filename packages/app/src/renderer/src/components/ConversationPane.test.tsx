// @vitest-environment jsdom
import type { TimelineEvent } from '@specdeck/protocol';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildTimeline } from '../model/timeline';
import { ConversationPane } from './ConversationPane';

const at = { at: Date.UTC(2026, 9, 30, 14, 5), outputSeq: 0 };
const prompt = (promptId: string, text: string): TimelineEvent => ({ kind: 'prompt', ...at, promptId, text });
const message = (promptId: string, text: string, final: boolean): TimelineEvent => ({
  kind: 'message',
  ...at,
  promptId,
  messageId: `${promptId}-m`,
  text,
  final,
});
const response = (promptId: string, text: string): TimelineEvent => ({ kind: 'response', ...at, promptId, text });

describe('ConversationPane', () => {
  it('shows a finished prompt with its sender, what Claude did and the formatted reply', () => {
    const timeline = buildTimeline([
      prompt('p1', 'Add rate limiting to the login'),
      { kind: 'tool-call', ...at, promptId: 'p1', toolUseId: 'b1', toolName: 'Bash', input: { command: 'pnpm test' } },
      { kind: 'tool-result', ...at, promptId: 'p1', toolUseId: 'b1', status: 'succeeded' },
      response('p1', '## Done\n\nLogin is limited to **5 attempts** a minute.\n\n- token bucket\n- tests added\n\n```ts\nlimit(5)\n```'),
    ]);
    render(<ConversationPane timeline={timeline} sender="nick" />);

    const exchange = screen.getByRole('article', { name: 'Prompt 1' });
    expect(within(exchange).getByText('Add rate limiting to the login')).toBeInTheDocument();
    expect(within(exchange).getByText(/^nick · /)).toBeInTheDocument();
    expect(within(exchange).getByText('Ran a command: succeeded')).toBeInTheDocument();
    expect(within(exchange).getByRole('heading', { name: 'Done' })).toBeInTheDocument();
    expect(within(exchange).getByText('5 attempts').tagName).toBe('STRONG');
    expect(within(exchange).getAllByRole('listitem').map((li) => li.textContent)).toContain('token bucket');
    expect(within(exchange).getByText('limit(5)').closest('pre')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a reply in progress and that Claude is still working', () => {
    const timeline = buildTimeline([prompt('p1', 'Explain the auth flow'), message('p1', 'The login handler first', false)]);
    render(<ConversationPane timeline={timeline} />);
    expect(screen.getByText('The login handler first')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Claude is working');
    expect(screen.getByText(/^Host · /)).toBeInTheDocument();
  });

  it('only shows the latest prompt as in progress, and nothing once the session ended', () => {
    const events = [prompt('p1', 'First'), message('p1', 'Interrupted answer', false), prompt('p2', 'Second')];
    const { rerender } = render(<ConversationPane timeline={buildTimeline(events)} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(within(screen.getByRole('article', { name: 'Prompt 2' })).getByRole('status')).toBeInTheDocument();

    rerender(<ConversationPane timeline={buildTimeline([...events, { kind: 'session-ended', ...at }])} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not render HTML or images from a reply', () => {
    const timeline = buildTimeline([
      prompt('p1', 'Show me'),
      response('p1', 'Before <script>alert(1)</script><b>bold</b> after\n\n![tracker](https://example.com/pixel.png)\n\n<img src="https://example.com/x.png">'),
    ]);
    const { container } = render(<ConversationPane timeline={timeline} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/Before/)).toBeInTheDocument();
  });

  it('by default opens a link with window.open, which the main process sends to the browser, and does not navigate', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const timeline = buildTimeline([prompt('p1', 'Docs?'), response('p1', 'See [the docs](https://example.com/docs).')]);
    render(<ConversationPane timeline={timeline} />);
    const followed = fireEvent.click(screen.getByRole('link', { name: 'the docs' }));
    expect(followed).toBe(false); // default prevented: the window stays on the app
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener');
    open.mockRestore();
  });

  it('opens a link through the handler instead of navigating', async () => {
    const onOpenLink = vi.fn();
    const timeline = buildTimeline([prompt('p1', 'Docs?'), response('p1', 'See [the docs](https://example.com/docs).')]);
    render(<ConversationPane timeline={timeline} onOpenLink={onOpenLink} />);
    await userEvent.click(screen.getByRole('link', { name: 'the docs' }));
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('says when the conversation cannot be shown and offers nerd mode', async () => {
    const onSwitchToNerd = vi.fn();
    const timeline = buildTimeline([{ kind: 'timeline-unavailable', ...at, reason: 'Claude Code hooks did not start.' }]);
    render(<ConversationPane timeline={timeline} onSwitchToNerd={onSwitchToNerd} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The conversation cannot be shown. Claude Code hooks did not start.');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to nerd mode' }));
    expect(onSwitchToNerd).toHaveBeenCalled();
  });
});
