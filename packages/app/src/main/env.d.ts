/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  /** Signalling service URL baked in at build time. */
  readonly MAIN_VITE_SIGNALLING_URL?: string;
}
