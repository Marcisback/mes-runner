import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeSensitiveText } from './sanitize.ts'

test('diagnostic sanitization removes URL queries and local profile paths', () => {
  assert.equal(
    sanitizeSensitiveText(
      'https://mes.example/path?token=value /Users/operator/AppData/profile',
    ),
    'https://mes.example/path [local-path]',
  )
  assert.equal(
    sanitizeSensitiveText('C:\\Users\\operator\\managed-chrome-profile'),
    '[local-path]',
  )
})

test('diagnostic sanitization redacts credential-like assignments', () => {
  assert.equal(
    sanitizeSensitiveText('cookie=session-value token:secret-value'),
    'cookie=[redacted] token=[redacted]',
  )
})
