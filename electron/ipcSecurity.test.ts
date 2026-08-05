import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  createRendererSecurityPolicy,
  isAllowedRendererUrl,
  isTrustedIpcSender,
  parseClipboardText,
} from './ipcSecurity.ts'

test('packaged renderer policy accepts only the exact bundled entry file', () => {
  const policy = createRendererSecurityPolicy('/opt/mes-runner', undefined)
  const allowed = pathToFileURL('/opt/mes-runner/dist/index.html').href
  assert.equal(isAllowedRendererUrl(allowed, policy), true)
  assert.equal(isAllowedRendererUrl(pathToFileURL('/tmp/index.html').href, policy), false)
  assert.equal(isAllowedRendererUrl('https://example.com/', policy), false)
})

test('development renderer policy accepts only its configured origin', () => {
  const policy = createRendererSecurityPolicy('/opt/mes-runner', 'http://localhost:5173/')
  assert.equal(isAllowedRendererUrl('http://localhost:5173/', policy), true)
  assert.equal(isAllowedRendererUrl('http://localhost:5173/settings', policy), true)
  assert.equal(isAllowedRendererUrl('http://127.0.0.1:5173/', policy), false)
  assert.equal(isAllowedRendererUrl('https://localhost:5173/', policy), false)
})

test('IPC authority requires the trusted main frame and renderer URL', () => {
  const policy = createRendererSecurityPolicy('/opt/mes-runner', 'http://localhost:5173/')
  const mainFrame = { url: 'http://localhost:5173/' }
  assert.equal(isTrustedIpcSender({ sender: { mainFrame }, senderFrame: mainFrame }, policy), true)
  assert.equal(isTrustedIpcSender({
    sender: { mainFrame },
    senderFrame: { url: 'http://localhost:5173/' },
  }, policy), false)
  const foreignFrame = { url: 'https://example.com/' }
  assert.equal(isTrustedIpcSender({
    sender: { mainFrame: foreignFrame },
    senderFrame: foreignFrame,
  }, policy), false)
})

test('clipboard IPC accepts only bounded non-empty text', () => {
  assert.equal(parseClipboardText('diagnostics'), 'diagnostics')
  assert.equal(parseClipboardText(''), null)
  assert.equal(parseClipboardText(42), null)
  assert.equal(parseClipboardText('x'.repeat(200_001)), null)
})
