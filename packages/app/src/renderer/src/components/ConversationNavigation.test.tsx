// @vitest-environment jsdom
import type { TimelineEvent } from '@claude-share/protocol';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTimeline } from '../model/timeline';
import { ConversationPane } from './ConversationPane';

// The `viewer-experience` scenarios for business mode: follow and free-scroll, search, jump to prompt.

const at = { at: 1, outputSeq: 0 };
const exchange = (n: number, text: string, reply: string): TimelineEvent[] => [
  { kind: 'prompt', ...at, promptId: `p${n}`, text },
  { kind: 'tool-call', ...at, promptId: `p${n}`, toolUseId: `b${n}`, toolName: 'Bash', input: { command: 'pnpm test' } },
  { kind: 'response', ...at, promptId: `p${n}`, text: reply },
];
const events = [
  ...exchange(1, 'Explain the login flow', 'The handler checks the **token bucket** first.'),
  ...exchange(2, 'Add a limit', 'Done.'),
  ...exchange(3, 'Write tests', 'Added three tests.'),
];
const more: TimelineEvent = { kind: 'prompt', ...at, promptId: 'p4', text: 'And the docs?' };

let scrolledTo: Element[];
beforeEach(() => {
  scrolledTo = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolledTo.push(this);
  });
});
afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

/** The scrolling body, with the sizes jsdom does not compute. */
function body(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>('.conversation .pane-body')!;
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 300 });
  return element;
}

describe('ConversationPane follow and free-scroll', () => {
  it('keeps the latest text in view while following', () => {
    const { container, rerender } = render(<ConversationPane timeline={buildTimeline(events)} />);
    const element = body(container);
    rerender(<ConversationPane timeline={buildTimeline([...events, more])} />);
    expect(element.scrollTop).toBe(1000);
    expect(screen.getByText('Following live')).toBeInTheDocument();
  });

  it('stays where the viewer scrolled back, says new messages are available, and follows again', async () => {
    const { container, rerender } = render(<ConversationPane timeline={buildTimeline(events)} />);
    const element = body(container);
    element.scrollTop = 100;
    fireEvent.scroll(element);
    expect(screen.getByRole('button', { name: 'Follow live' })).toBeInTheDocument();

    rerender(<ConversationPane timeline={buildTimeline([...events, more])} />);
    expect(element.scrollTop).toBe(100);
    await userEvent.click(screen.getByRole('button', { name: 'New messages · follow live' }));
    expect(element.scrollTop).toBe(1000);
    expect(screen.getByText('Following live')).toBeInTheDocument();
  });
});

describe('ConversationPane scrolling', () => {
  it('survives scroll events that React handles after the event (the page went blank)', async () => {
    const { container } = render(<ConversationPane timeline={buildTimeline(events)} />);
    const element = body(container);
    element.scrollTop = 100;
    // The second update is queued and runs after the event, when React has cleared currentTarget.
    await act(async () => {
      fireEvent.scroll(element);
      fireEvent.scroll(element);
    });
    expect(screen.getByRole('button', { name: 'Follow live' })).toBeInTheDocument();
  });
});

describe('ConversationPane search', () => {
  it('highlights messages matching a word from an earlier reply and steps through them', async () => {
    render(<ConversationPane timeline={buildTimeline(events)} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search the conversation' }), 'token');
    expect(screen.getByRole('status', { name: 'Search results' })).toHaveTextContent('1 found');
    expect(screen.getByRole('article', { name: 'Prompt 1' })).toHaveClass('search-match');

    await userEvent.keyboard('{Enter}');
    const first = screen.getByRole('article', { name: 'Prompt 1' });
    expect(first).toHaveAttribute('aria-current', 'true');
    expect(scrolledTo).toEqual([first]);
    expect(screen.getByRole('status', { name: 'Search results' })).toHaveTextContent('1 of 1');
  });

  it('steps through several matches with the buttons', async () => {
    render(<ConversationPane timeline={buildTimeline(events)} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search the conversation' }), 'test');
    await userEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(screen.getByRole('article', { name: 'Prompt 3' })).toHaveAttribute('aria-current', 'true');
  });

  it('says when nothing matches, and does not search tool details', async () => {
    render(<ConversationPane timeline={buildTimeline(events)} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search the conversation' }), 'pnpm');
    expect(screen.getByRole('status', { name: 'Search results' })).toHaveTextContent('No matches');
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
  });
});

describe('ConversationPane jump to prompt', () => {
  it('scrolls to the chosen prompt and switches to free-scroll', async () => {
    render(<ConversationPane timeline={buildTimeline(events)} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Jump to prompt' }), 'p3');
    expect(scrolledTo).toEqual([screen.getByRole('article', { name: 'Prompt 3' })]);
    expect(screen.getByRole('button', { name: 'Follow live' })).toBeInTheDocument();
  });

  it('lists every prompt with its number', () => {
    render(<ConversationPane timeline={buildTimeline(events)} />);
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Jump to prompt…', '#1 Explain the login flow', '#2 Add a limit', '#3 Write tests']);
  });
});

