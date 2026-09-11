import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface MacManBundledRuntime {
  python: string
  pythonRoot: string
  sitePackages: string
  sourceRoot: string
}

export function resolveMacManBundledRuntime(resourcesPath: string): MacManBundledRuntime | null {
  const root = join(resourcesPath, 'macman-runtime')
  const pythonRoot = join(root, 'python')

  const runtime = {
    python: join(pythonRoot, 'bin', 'python3.11'),
    pythonRoot,
    sitePackages: join(root, 'site-packages'),
    sourceRoot: join(root, 'source')
  }

  return [runtime.python, runtime.sitePackages, join(runtime.sourceRoot, 'hermes_cli', 'main.py')].every(existsSync)
    ? runtime
    : null
}
