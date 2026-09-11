import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, test } from 'vitest'

import { resolveMacManBundledRuntime } from './macman-bundled-runtime'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('resolves only a complete MacMan-owned agent runtime', () => {
  const resources = mkdtempSync(join(tmpdir(), 'macman-runtime-test-'))
  const runtime = join(resources, 'macman-runtime')
  temporaryDirectories.push(resources)

  mkdirSync(join(runtime, 'python', 'bin'), { recursive: true })
  mkdirSync(join(runtime, 'site-packages'), { recursive: true })
  mkdirSync(join(runtime, 'source', 'hermes_cli'), { recursive: true })
  writeFileSync(join(runtime, 'python', 'bin', 'python3.11'), '')
  writeFileSync(join(runtime, 'source', 'hermes_cli', 'main.py'), '')

  assert.equal(resolveMacManBundledRuntime(resources), null)

  writeFileSync(join(runtime, 'python', 'bin', 'hermes'), '')
  assert.deepEqual(resolveMacManBundledRuntime(resources), {
    launcher: join(runtime, 'python', 'bin', 'hermes'),
    python: join(runtime, 'python', 'bin', 'python3.11'),
    pythonRoot: join(runtime, 'python'),
    sitePackages: join(runtime, 'site-packages'),
    sourceRoot: join(runtime, 'source')
  })
})
