/// <reference types="vite-plugin-electron/electron-env" />

import type { ManagedChromeApi } from '../src/types/managedChrome'
import type { EolRunnerApi } from '../src/types/eolRunner'
import type { ClipboardApi } from '../src/types/clipboard'
import type { HistoryApi } from '../src/types/history'

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * The built directory structure
       *
       * ```tree
       * ├─┬─┬ dist
       * │ │ └── index.html
       * │ │
       * │ ├─┬ dist-electron
       * │ │ ├── main.js
       * │ │ └── preload.js
       * │
       * ```
       */
      APP_ROOT: string
    }
  }

  interface Window {
    managedChrome: ManagedChromeApi
    eolRunner: EolRunnerApi
    mesClipboard: ClipboardApi
    mesHistory: HistoryApi
  }
}

export {}
