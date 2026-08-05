import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveActiveWorkflowAsset } from './activeWorkflowAssetCore.ts'

test('no active WRO resolves none', () => {
  assert.equal(resolveActiveWorkflowAsset(false, [], 'IT100').relation, 'none')
})

test('exact labeled Asset tag resolves current or different after trimming', () => {
  assert.equal(resolveActiveWorkflowAsset(true, [
    { label: 'Asset tag:', values: [' IT100 '], fieldContainerResolved: true },
  ], 'IT100').relation, 'current')
  assert.equal(resolveActiveWorkflowAsset(true, [
    { label: 'Asset tag', values: ['it099'], fieldContainerResolved: true },
  ], 'IT100').relation, 'different')
})

test('unresolved and multiple Asset tag fields fail closed', () => {
  assert.equal(resolveActiveWorkflowAsset(true, [], 'IT100').relation, 'unknown')
  const multiple = resolveActiveWorkflowAsset(true, [
    { label: 'Asset tag', values: ['IT100'], fieldContainerResolved: true },
    { label: 'Asset tag', values: ['IT100'], fieldContainerResolved: true },
  ], 'IT100')
  assert.equal(multiple.relation, 'ambiguous')
  assert.equal(multiple.assetTagCandidateCount, 2)
})

test('WRO and Serial number are not accepted as Asset tag', () => {
  const result = resolveActiveWorkflowAsset(true, [
    { label: 'WRO number', values: ['IT100'], fieldContainerResolved: true },
    { label: 'Serialized part ID', values: ['IT100'], fieldContainerResolved: true },
    { label: 'Serial number', values: ['IT100'], fieldContainerResolved: true },
    { label: 'FBPN', values: ['IT100'], fieldContainerResolved: true },
    { label: 'Location', values: ['IT100'], fieldContainerResolved: true },
  ], 'IT100')
  assert.equal(result.relation, 'unknown')
  assert.equal(result.assetTagResolved, false)
})

test('adjacent, linked, and nested field values resolve from scoped inputs', () => {
  for (const value of ['IT2830528', ' it2830528 ', 'IT 2830528']) {
    const result = resolveActiveWorkflowAsset(true, [{
      label: 'Asset tag',
      values: [value],
      fieldContainerResolved: true,
    }], 'IT2830528')
    assert.equal(result.relation, 'current')
    assert.equal(result.validValueCandidateCount, 1)
  }
})

test('missing and multiple valid values remain unresolved or ambiguous', () => {
  assert.equal(resolveActiveWorkflowAsset(true, [{
    label: 'Asset tag',
    values: [],
    fieldContainerResolved: false,
  }], 'IT100').relation, 'unknown')
  const result = resolveActiveWorkflowAsset(true, [{
    label: 'Asset tag',
    values: ['IT100', 'IT101'],
    fieldContainerResolved: true,
  }], 'IT100')
  assert.equal(result.relation, 'ambiguous')
  assert.equal(result.validValueCandidateCount, 2)
})
