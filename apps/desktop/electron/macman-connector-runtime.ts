import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { MacManConnectionId } from './macman-connections-controller'

const MAX_CONNECTOR_OUTPUT_BYTES = 1024 * 1024

const CONNECTOR_PATHS: Record<MacManConnectionId, (arch: string) => string[]> = {
  gmail: arch => ['gmail', arch, 'gog'],
  imessage: () => ['imessage', 'universal', 'imessage-cli'],
  whatsapp: () => ['whatsapp', 'universal', 'bridge.js']
}

export function macManConnectorResourcesRoot(appPath: string, resourcesPath: string, isPackaged: boolean): string {
  return isPackaged ? resourcesPath : join(appPath, 'build')
}

export function resolveMacManConnectorExecutable(
  resourcesPath: string,
  connector: MacManConnectionId,
  arch = process.arch
): null | string {
  const executable = join(resourcesPath, 'macman-connectors', ...CONNECTOR_PATHS[connector](arch))

  return existsSync(executable) ? executable : null
}

export function macManConnectorBackendEnvironment(
  resourcesPath: string,
  dataRoot: string,
  arch = process.arch
): { GOG_HOME: string; MACMAN_IMESSAGE_DATA_DIR: string; pathEntries: string[] } {
  const executables = [
    resolveMacManConnectorExecutable(resourcesPath, 'gmail', arch),
    resolveMacManConnectorExecutable(resourcesPath, 'imessage', arch)
  ]

  return {
    GOG_HOME: join(dataRoot, 'gmail'),
    MACMAN_IMESSAGE_DATA_DIR: join(dataRoot, 'imessage'),
    pathEntries: executables.flatMap(executable => (executable ? [join(executable, '..')] : []))
  }
}

export function runMacManConnector(
  executable: string,
  args: string[],
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {}
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return new Promise(resolve => {
    const child = spawn(executable, args, {
      env: { ...process.env, NO_COLOR: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let terminalError = ''

    const timer = setTimeout(() => {
      terminalError = `Connector timed out after ${timeoutMs}ms`
      child.kill('SIGKILL')
    }, Math.max(1, timeoutMs))
    timer.unref?.()

    const append = (current: string, chunk: Buffer | string): string => {
      const next = current + chunk.toString()

      if (Buffer.byteLength(next) > MAX_CONNECTOR_OUTPUT_BYTES) {
        terminalError = `Connector output exceeded ${MAX_CONNECTOR_OUTPUT_BYTES} bytes`
        child.kill('SIGKILL')

        return next.slice(0, MAX_CONNECTOR_OUTPUT_BYTES)
      }

      return next
    }

    child.stdout?.on('data', chunk => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', chunk => {
      stderr = append(stderr, chunk)
    })

    child.once('error', error => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve({ exitCode: -1, stderr: terminalError || error.message, stdout })
    })

    child.once('close', code => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve({
        exitCode: terminalError ? -1 : (code ?? -1),
        stderr: terminalError ? `${stderr}${stderr ? '\n' : ''}${terminalError}` : stderr,
        stdout
      })
    })
  })
}
