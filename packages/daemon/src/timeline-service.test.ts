import type { TimelineEvent } from '@specdeck/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostSession } from './host-session.ts';
import { FakePty } from './test-support.ts';
import { TimelineService } from './timeline-service.ts';

const prompt = (id: string) => ({ hook_event_name: 'UserPromptSubmit', prompt_id: id, prompt: `prompt ${id}` });

describe('TimelineService', () => {
  let events: TimelineEvent[];
  let service: TimelineService;

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    service = new TimelineService({
      cwd: '/workspace',
      outputSeq: () => 0,
      emit: (event) => events.push(event),
      firstEventTimeoutMs: 15_000,
    });
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  it('reports the timeline unavailable when a payload cannot be parsed, while the terminal keeps streaming', () => {
    const pty = new FakePty();
    const session = new HostSession(pty, { cols: 80, rows: 24 });
    const output: string[] = [];
    session.onOutput((_, data) => output.push(data));

    service.handleHook(prompt('p1'));
    service.handleHook({ hook_event_name: 'UserPromptSubmit', prompt_id: 'p2', prompt: 42 });
    service.handleHook(prompt('p3'));
    pty.emit('the terminal still works\r\n');

    expect(events.map((e) => e.kind)).toEqual(['prompt', 'timeline-unavailable']);
    expect(events[1]).toMatchObject({ reason: expect.stringContaining('does not understand') });
    expect(output).toEqual(['the terminal still works\r\n']);
    session.dispose();
  });

  it('reports the timeline unavailable when no event arrives after the host submits input', () => {
    service.hostSubmitted();
    vi.advanceTimersByTime(14_999);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toMatchObject([{ kind: 'timeline-unavailable', reason: expect.stringContaining('not sending events') }]);
  });

  it('recovers when events start arriving after all', () => {
    service.hostSubmitted();
    vi.advanceTimersByTime(15_000);
    service.handleHook(prompt('p1'));
    expect(events.map((e) => e.kind)).toEqual(['timeline-unavailable', 'timeline-available', 'prompt']);
  });

  it('does not treat quiet periods as a failure once events have arrived', () => {
    service.handleHook(prompt('p1'));
    service.hostSubmitted();
    vi.advanceTimersByTime(60_000);
    expect(events.map((e) => e.kind)).toEqual(['prompt']);
  });

  it('does not report a failure when the first event arrives in time', () => {
    service.hostSubmitted();
    vi.advanceTimersByTime(5_000);
    service.handleHook(prompt('p1'));
    vi.advanceTimersByTime(60_000);
    expect(events.map((e) => e.kind)).toEqual(['prompt']);
  });
});
