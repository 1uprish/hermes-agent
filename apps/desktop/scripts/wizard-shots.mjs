#!/usr/bin/env node
// Dev-iteration helper: screenshot every onboarding-wizard stage against the
// running Vite renderer (npm run dev:renderer). Not a test — a look loop.
//
//   node scripts/wizard-shots.mjs [outDir] [dark|light|both]

import { chromium } from 'playwright-core'

const OUT = process.argv[2] || '/tmp/wizard-shots'
const MODE = process.argv[3] || 'both'
// The standalone wizard window page — exactly what the dedicated Electron
// window loads. No app shell, no gateway, no boot-failure artifacts.
const URL = 'http://127.0.0.1:5174/?win=onboarding&providers=1'

const STEPS = ['welcome', 'personalize', 'connectors', 'appearance', 'providers', 'system']

async function shoot(browser, scheme) {
  const context = await browser.newContext({
    colorScheme: scheme,
    // The dedicated window's size (electron/main.ts spawnOnboardingWizardWindow):
    // the window IS the card.
    viewport: { width: 720, height: 500 }
  })
  const page = await context.newPage()
  page.on('console', message => {
    if (message.type() === 'error') console.log(`[${scheme}] console.error: ${message.text().slice(0, 200)}`)
  })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  // Wait for the surface (and the dev hooks) to mount.
  await page.waitForFunction(() => typeof window.__onboarding !== 'undefined', { timeout: 30000 })
  await page.waitForTimeout(1200)

  for (const step of STEPS) {
    await page.evaluate(id => window.__onboarding.start(id), step)
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/${scheme}-${step}.png` })
    console.log(`${scheme}-${step}.png`)
  }

  // Finale (capture mid-hold, before the 3.2s auto-complete).
  await page.evaluate(() => window.__onboarding.finale())
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/${scheme}-finale.png` })
  console.log(`${scheme}-finale.png`)

  await context.close()
}

// Installed Chrome, headless — no playwright browser download needed.
const browser = await chromium.launch({ channel: 'chrome' })

if (MODE === 'both' || MODE === 'dark') await shoot(browser, 'dark')
if (MODE === 'both' || MODE === 'light') await shoot(browser, 'light')

await browser.close()
