import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

// jsdom has no ResizeObserver; the resizable panels and the terminal only need it to exist.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom lays nothing out: every element is a 0x0 box at (0, 0), where user-event also clicks. The
// resizable panels would take every click as a press on their separators and steal focus, so place
// separators away from that point.
if (typeof window !== 'undefined') {
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.getAttribute('role') === 'separator' ? new DOMRect(-1000, -1000, 1, 1) : rect.call(this);
  };
}
