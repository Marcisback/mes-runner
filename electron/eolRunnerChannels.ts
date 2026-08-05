export const EOL_RUNNER_IPC_CHANNELS = {
  create: 'eol-runner:create',
  close: 'eol-runner:close',
  list: 'eol-runner:list',
  get: 'eol-runner:get',
  start: 'eol-runner:start',
  pause: 'eol-runner:pause',
  resume: 'eol-runner:resume',
  stop: 'eol-runner:stop',
  snapshotChanged: 'eol-runner:snapshot-changed',
  removed: 'eol-runner:removed',
} as const
