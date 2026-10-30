/// <reference types="vite/client" />

import type { Bridge } from '../../shared/bridge';

declare global {
  interface Window {
    /** Exposed by the preload script (src/preload/index.ts). */
    specDeck: Bridge;
  }
}
