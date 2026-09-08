#!/usr/bin/env node
/**
 * Run the guided first-run flow against a throwaway install.
 *
 *   npm run dev:fresh             (from apps/desktop)
 *   npm run dev:mock              the same flow, scripted — no model, no venv
 *   ... -- --new                  ...as if this machine were unboxed today
 *   ... -- --spark                ...as if it were an RTX Spark, unboxed today
 *   ... -- --movie                cinematic first, then the guided chat
 *
 * Onboarding happens once per install and writes as it goes — profiles
 * (`hermes-setup`, then the task bot), Electron latches, connection state. So
 * testing it needs a sandbox, and it needs all three of these or it silently
 * does the wrong thing:
 *
 *   HOME                          profiles are HOME-anchored by design
 *                                 (`_get_profiles_root`), so this is what keeps
 *                                 minted bots out of your real ~/.hermes
 *   HERMES_HOME                   must be explicit — the user-data override
 *                                 alone relocates it to an EMPTY dir, and an
 *                                 empty home means the first-run installer
 *                                 instead of the flow (looks like a hang)
 *   HERMES_DESKTOP_USER_DATA_DIR  Electron ignores HOME for userData on macOS,
 *                                 so without it the onboarding latches in your
 *                                 real profile suppress the whole thing
 *
 * Credentials are copied from your real ~/.hermes: the flow needs a working
 * model, not a working install.
 *
 * The sandbox is wiped every run — a second run of a once-per-install flow
 * tests nothing. Pass --keep to resume one (e.g. to inspect what it wrote).
 *
 * --mock replaces the backend with scripts/mock-gateway: the same flow, every
 * turn scripted, in milliseconds. Use it for UI iteration and demo rehearsal,
 * where waiting on a real model between every card is the whole cost; use the
 * default when what you are testing is the model actually driving the flow.
 */

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const SANDBOX = path.join(os.tmpdir(), 'hermes-dev-fresh')

// dev:electron waits on this exact port, and vite quietly increments past a
// busy one — which strands the launch instead of failing it.
const RENDERER_PORT = 5174

// Enough of a real install to reach a model; everything else is born fresh.
const SEED_FILES = ['.env', 'config.yaml', 'auth.json']

/**
 * The listener on `port`, as `{ pid, from }` — `from` being the checkout it was
 * launched from, which is the part that actually resolves the confusion: with
 * several worktrees open, the window on screen is often a DIFFERENT branch's
 * dev server, and it looks exactly like this one failing. POSIX only; a null
 * result just keeps the message generic.
 */
function listenerOn(port) {
  const found = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'], { encoding: 'utf8' })
  const pid = (found.stdout ?? '').match(/^p(\d+)$/m)?.[1]

  if (pid == null) {
    return null
  }

  const argv = spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).stdout ?? ''

  return { from: argv.match(/(\/.*?)\/node_modules\//)?.[1] ?? '', pid }
}

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net
      .createServer()
      .once('error', () => {
        const holder = listenerOn(port)

        // Loud on purpose. This refusal is the ONE way a fresh run fails, and
        // a single line scrolls past in npm's output — someone reads it, keeps
        // looking at the dev server they already had open, and reports the old
        // app's behaviour as this branch's.
        reject(
          new Error(
            [
              '',
              '  ┌─ NOT STARTED ─────────────────────────────────────────────',
              `  │  Port ${port} is already taken, so nothing was launched.`,
              '  │  Any Hermes window open right now is that other server,',
              '  │  on your REAL ~/.hermes — not a fresh run of this branch.',
              '  │',
              holder?.from ? `  │  It belongs to:  ${holder.from}` : '  │  Another dev server has it.',
              holder ? `  │  Stop it:        kill ${holder.pid}` : '  │  Stop it, then re-run.',
              '  └───────────────────────────────────────────────────────────',
              ''
            ].join('\n')
          )
        )
      })
      .once('listening', () => probe.close(() => resolve()))
      .listen(port, '127.0.0.1')
  })
}

function stageSandbox({ keep, mock }) {
  const hermesHome = path.join(SANDBOX, '.hermes')
  const userDataDir = path.join(SANDBOX, 'electron-user-data')

  if (!keep) {
    fs.rmSync(SANDBOX, { force: true, recursive: true })
  }

  fs.mkdirSync(hermesHome, { recursive: true })
  fs.mkdirSync(userDataDir, { recursive: true })

  // os.homedir() still reads the REAL home — nothing has been overridden yet.
  const source = path.join(os.homedir(), '.hermes')
  const copied = SEED_FILES.filter(name => {
    const from = path.join(source, name)

    if (!fs.existsSync(from)) {
      return false
    }

    fs.copyFileSync(from, path.join(hermesHome, name))

    return true
  })

  // The mock answers for the backend, credentials included, so an unconfigured
  // machine can still run the flow — that is half the point of it.
  if (copied.length === 0 && !mock) {
    throw new Error(
      `Nothing to seed from ${source} — no .env, config.yaml or auth.json.\n` +
        'The guided flow needs a working model. Configure Hermes normally first,\n' +
        'or run the scripted flow instead: npm run dev:mock'
    )
  }

  return { copied, hermesHome, userDataDir }
}

/**
 * Env for the scripted backend. HERMES_DESKTOP_PYTHON is the seam: the app
 * spawns `<python> -m hermes_cli.main --profile X serve …` per profile, and the
 * shim answers that argv with a mock gateway instead. Every profile's shim
 * shares one state file, so Setup's chat, the minted task bot and the roster
 * stay one logical backend.
 */
function mockEnv(hermesHome) {
  const mockDir = path.join(DESKTOP_ROOT, 'scripts', 'mock-gateway')

  return {
    HERMES_DESKTOP_PYTHON: path.join(mockDir, 'mock_hermes_shim.py'),
    HERMES_MOCK_STATE: path.join(hermesHome, 'mock-state.json')
  }
}

/**
 * Fields to answer the machine probe with instead of this host's — they overlay
 * the real ones, so --new is a brand-new version of the machine you are sitting
 * at, and --spark is somebody else's entirely.
 *
 * Both are unboxed today, because a fresh machine is the case the whole path is
 * for: it is where taking over the drivers, the updates and the toolchain is
 * worth an afternoon of someone's life. On a lived-in machine setup is one
 * option among five, which is what your own host already shows you.
 */
const PRETEND = {
  new: { ageDays: 0 },
  spark: { ageDays: 0, arch: 'arm64', model: '', nvidia: true, platform: 'win32', release: '10.0.26100' }
}

async function main() {
  const keep = process.argv.includes('--keep')
  const mock = process.argv.includes('--mock')
  const movie = process.argv.includes('--movie')
  const pretend = Object.keys(PRETEND).find(name => process.argv.includes(`--${name}`))

  await assertPortFree(RENDERER_PORT)

  const { copied, hermesHome, userDataDir } = stageSandbox({ keep, mock })

  console.log(`${mock ? 'Scripted' : 'Fresh'} guided run — sandbox at ${SANDBOX}${keep ? ' (kept)' : ''}`)
  console.log(`  seeded: ${copied.join(', ') || 'nothing (the mock answers)'}`)
  if (pretend) {
    console.log(`  machine: ${pretend === 'spark' ? 'an RTX Spark' : 'this one'}, unboxed today`)
  }
  console.log('')
  console.log(
    movie
      ? '  Watch for: cinematic → guided chat → name, color, connectors,'
      : '  Watch for: guided chat → name, color, connectors,'
  )
  console.log('  layout → the fork → the handoff card asking bot vs session.')
  console.log('  Elite layout leads with session, Basic with bot.')
  console.log('')
  if (!mock) {
    console.log(`  Setup's check-in cron: HOME=${SANDBOX} hermes -p hermes-setup cron list`)
    console.log('')
  }

  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', movie ? 'dev:full' : 'dev:chat'], {
    cwd: DESKTOP_ROOT,
    env: {
      ...process.env,
      ...(mock ? mockEnv(hermesHome) : {}),
      ...(pretend ? { HERMES_DESKTOP_FAKE_MACHINE: JSON.stringify(PRETEND[pretend]) } : {}),
      HERMES_DESKTOP_USER_DATA_DIR: userDataDir,
      HERMES_HOME: hermesHome,
      HOME: SANDBOX
    },
    stdio: 'inherit'
  })

  child.on('exit', code => process.exit(code ?? 0))
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
