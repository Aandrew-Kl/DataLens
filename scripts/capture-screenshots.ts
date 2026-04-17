import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'

const BASE_URL = 'http://127.0.0.1:3000'
const SERVER_TIMEOUT_MS = 60_000
const HEALTH_POLL_MS = 500
const SCREENSHOT_DIR = path.join(process.cwd(), 'docs-site', 'public', 'images', 'screenshots')
const SAMPLE_CSV = path.join(process.cwd(), 'public', 'sample-data', 'ecommerce-orders.csv')
const SQL = [
  'SELECT country, SUM(total_amount) AS revenue',
  'FROM ecommerce_orders',
  'GROUP BY country',
  'ORDER BY revenue DESC',
  'LIMIT 10;',
].join(' ')

type ScreenshotTask = { fileName: string; run: () => Promise<void> }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rememberLogs(child: ChildProcess) {
  const lines: string[] = []
  const push = (label: string, chunk: Buffer | string) => {
    const text = chunk.toString()
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      lines.push(`[${label}] ${trimmed}`)
      if (lines.length > 80) lines.shift()
    }
  }

  child.stdout?.on('data', (chunk) => push('dev', chunk))
  child.stderr?.on('data', (chunk) => push('dev:err', chunk))
  return () => lines.join('\n')
}

function startDevServer() {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_DEMO_MODE: 'true',
      DATALENS_DEMO_MODE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return { child, getLogs: rememberLogs(child) }
}

async function waitForServer(child: ChildProcess, getLogs: () => string) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < SERVER_TIMEOUT_MS) {
    if (child.exitCode != null) {
      throw new Error(`Dev server exited early with code ${child.exitCode}.\n${getLogs()}`)
    }

    for (const pathname of ['/api/health', '/']) {
      try {
        const response = await fetch(`${BASE_URL}${pathname}`, {
          signal: AbortSignal.timeout(4_000),
        })
        if (response.status === 200) {
          return
        }
      } catch {
        // Keep polling until timeout.
      }
    }

    await sleep(HEALTH_POLL_MS)
  }

  throw new Error(
    `Dev server did not become ready within ${SERVER_TIMEOUT_MS / 1000}s.\n${getLogs()}`,
  )
}

async function stopDevServer(child: ChildProcess) {
  if (child.exitCode != null) return

  child.kill('SIGTERM')
  const exited = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve(true)
    })
  })

  if (!exited && child.exitCode == null) {
    child.kill('SIGKILL')
  }
}

async function createContext() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(5_000)
  page.setDefaultTimeout(15_000)
  return { browser, context, page }
}

async function waitForWorkspace(page: Page) {
  const checks = [
    () => page.locator('[data-testid="workspace"]').waitFor({ state: 'visible', timeout: 2_000 }),
    () => page.locator('body.workspace').waitFor({ state: 'visible', timeout: 2_000 }),
    () => page.getByRole('link', { name: /^SQL$/i }).waitFor({ state: 'visible', timeout: 5_000 }),
  ]

  for (const check of checks) {
    try {
      await check()
      return
    } catch {
      // Try the next marker.
    }
  }

  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined)
  await page.locator('body').waitFor()
}

async function navigateTo(page: Page, paths: string[], heading: RegExp) {
  for (const pathname of paths) {
    const response = await page.goto(`${BASE_URL}${pathname}`, {
      waitUntil: 'domcontentloaded',
    })
    if (response && response.status() >= 400) continue
    if (await page.getByText(/page could not be found/i).count()) continue
    await waitForWorkspace(page)
    await page.getByRole('heading', { name: heading }).waitFor({ state: 'visible' })
    return
  }

  throw new Error(`Unable to open any route from: ${paths.join(', ')}`)
}

async function clickNavOrOpen(page: Page, linkName: RegExp, paths: string[], heading: RegExp) {
  const navLink = page.getByRole('link', { name: linkName }).first()
  if (await navLink.count()) {
    await navLink.click()
    await page.getByRole('heading', { name: heading }).waitFor({ state: 'visible' })
    return
  }

  await navigateTo(page, paths, heading)
}

async function uploadSampleDataset(page: Page) {
  await navigateTo(page, ['/dashboard', '/profile'], /workspace dashboard|profile/i)
  await page.getByRole('button', { name: /new dataset/i }).first().click()
  await page.getByRole('heading', { name: /upload dataset/i }).waitFor()
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_CSV)
  await page.getByText('ecommerce-orders.csv').first().waitFor({ state: 'visible' })
  await page.getByRole('heading', { name: /upload dataset/i }).waitFor({ state: 'hidden' })
  await sleep(750)
}

async function saveScreenshot(page: Page, fileName: string) {
  await mkdir(SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, fileName), fullPage: false })
}

async function captureSampleGallery() {
  const { browser, context, page } = await createContext()
  try {
    await page.goto(`${BASE_URL}/quality`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /revenue performance/i }).waitFor()
    await page.getByRole('button', { name: /revenue performance/i }).click()
    await page.getByRole('button', { name: /new dataset/i }).waitFor()
    await page.getByRole('button', { name: /new dataset/i }).click()
    await page.getByText('Sample datasets').waitFor({ state: 'visible' })
    await page.getByText('Sample datasets').scrollIntoViewIfNeeded()
    await sleep(500)
    await saveScreenshot(page, '05-sample-gallery.png')
  } finally {
    await context.close()
    await browser.close()
  }
}

async function main() {
  const { child, getLogs } = startDevServer()
  let failures = 0
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  try {
    await waitForServer(child, getLogs)

    const browserSession = await createContext()
    browser = browserSession.browser
    context = browserSession.context
    const { page } = browserSession
    await uploadSampleDataset(page)

    const tasks: ScreenshotTask[] = [
      {
        fileName: '01-sql-editor.png',
        run: async () => {
          await clickNavOrOpen(page, /^SQL$/i, ['/workspace/query', '/sql', '/query'], /sql editor/i)
          await page.getByLabel(/sql editor/i).fill(SQL)
          await page.getByRole('button', { name: /^run$/i }).click()
          await page.getByRole('table').first().waitFor({ state: 'visible' })
          await saveScreenshot(page, '01-sql-editor.png')
        },
      },
      {
        fileName: '02-chart-builder.png',
        run: async () => {
          await clickNavOrOpen(page, /^Charts$/i, ['/workspace/charts', '/charts'], /^charts$/i)
          await page.getByRole('button', { name: /new chart/i }).click()
          await page.locator('canvas').first().waitFor({ state: 'visible' })
          await saveScreenshot(page, '02-chart-builder.png')
        },
      },
      {
        fileName: '03-dashboard.png',
        run: async () => {
          await clickNavOrOpen(
            page,
            /^Dashboard$/i,
            ['/workspace/dashboards', '/workspace/dashboard', '/dashboard'],
            /workspace dashboard/i,
          )
          await page.getByText(/saved charts/i).waitFor({ state: 'visible' })
          await saveScreenshot(page, '03-dashboard.png')
        },
      },
      {
        fileName: '04-ai-assistant.png',
        run: async () => {
          await clickNavOrOpen(
            page,
            /^Ask AI$/i,
            ['/workspace/ai', '/workspace/query', '/query'],
            /^ask ai$/i,
          )
          await page.getByPlaceholder(/ask about trends, averages, or segments/i).waitFor({
            state: 'visible',
          })
          await saveScreenshot(page, '04-ai-assistant.png')
        },
      },
      {
        fileName: '05-sample-gallery.png',
        run: captureSampleGallery,
      },
    ]

    for (const task of tasks) {
      try {
        await task.run()
        console.log(`Captured ${task.fileName}`)
      } catch (error) {
        failures += 1
        console.error(
          `Failed to capture ${task.fileName}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        )
      }
    }

    await context.close()
    await browser.close()
  } finally {
    if (context) {
      await context.close().catch(() => undefined)
    }
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    await stopDevServer(child)
  }

  process.exitCode = failures === 0 ? 0 : 1
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Screenshot capture failed.')
  process.exitCode = 1
})
