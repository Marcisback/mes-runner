export const EOL_RUNNER_IPC_CHANNELS = {
  start: 'eol-runner:start',
  pause: 'eol-runner:pause',
  resume: 'eol-runner:resume',
  stop: 'eol-runner:stop',
  getSnapshot: 'eol-runner:get-snapshot',
  snapshotChanged: 'eol-runner:snapshot-changed',
} as const
