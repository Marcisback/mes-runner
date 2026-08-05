# MES Runner

Electron, React, and TypeScript desktop automation for proven internal MES
workflows through organization-managed Google Chrome.

## Development

```bash
npm install
npm run dev
```

The application owns managed Chrome, Playwright automation, and local SQLite
history in the Electron main process. React communicates through typed preload
APIs and never receives browser objects, SQL, or database handles.

Local history is created automatically at
`path.join(app.getPath('userData'), 'mes-runner.sqlite')`. It stores final
completed and needs-review outcomes only. Credentials, cookies, screenshots,
page content, and full diagnostics are not stored.

## Validation

```bash
npm test
npm run lint
npx tsc --noEmit
npx vite build
npm run build
```

`npm run build` compiles the application and packages the SQLite native module.
On the current macOS development machine, the final DMG step may fail in
`hdiutil` after application packaging has succeeded.

See [CLAUDE.md](./CLAUDE.md) for architecture and engineering requirements.
