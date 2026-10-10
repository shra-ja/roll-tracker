import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { backendCargo, backendEnvironment } from '../tooling/backend-coverage'
import { DOWN, ENTER, ESCAPE, RIGHT, TAB, launch, type AppSession } from './app-driver'

let backendEnv: NodeJS.ProcessEnv
// A synthetic cache file holding one warp history request, with a key distinctive
// enough to search the app's files for.
const authKey = 'synthetic-e2e-auth-key'
const cachePath = resolve('test-results/synthetic-data_2')
beforeAll(() => {
  // Extraction now validates with HoYoverse: refuse to run where the synthetic key
  // could reach the live endpoint. The network namespace must have only loopback.
  const interfaces = readFileSync('/proc/self/net/dev', 'utf8')
    .split('\n')
    .slice(2)
    .map((line) => line.split(':')[0].trim())
    .filter(Boolean)
  if (interfaces.join() !== 'lo') throw new Error('run the native test through test:offline')
  backendEnv = backendEnvironment()
  // The mock feature also builds the mock debug binary (decision 0014).
  backendCargo(['build', '--locked', '--offline', '--features', 'mock'])
  mkdirSync('test-results', { recursive: true })
  writeFileSync(
    cachePath,
    `1/0/https://public-operation-hkrpg-sg.hoyoverse.com/common/hkrpg_gacha_record/api/getGachaLog?authkey=${authKey}&authkey_ver=1&sign_type=2&game_biz=hkrpg_global&lang=en\0`,
  )
}, 600000)
afterAll(() => rmSync(cachePath, { force: true }))

// Keep automatic discovery deterministic: never start Windows helpers from a WSL test host.
const environment = (extra: NodeJS.ProcessEnv = {}) => ({
  ...backendEnv,
  WSL_DISTRO_NAME: '',
  ...extra,
})
const textOf = (app: AppSession, selector: string) =>
  app.execute<string | undefined>(`return document.querySelector("${selector}")?.textContent`)
const heading = (app: AppSession) => textOf(app, 'h1')
/** The tooltip of the element matching `selector`: its text, whether it shows, and where. */
const tooltipFor = (app: AppSession, selector: string) =>
  app.execute<{ text: string; shown: boolean; inWindow: boolean; overlaps: boolean }>(`
    const target = document.querySelector(${JSON.stringify(selector)});
    const tip = target.parentElement.querySelector('[role=tooltip]');
    const own = target.getBoundingClientRect(), box = tip.getBoundingClientRect();
    return {
      text: tip.textContent,
      shown: getComputedStyle(tip).display !== 'none',
      inWindow: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      overlaps: box.left < own.right && own.left < box.right && box.top < own.bottom && own.top < box.bottom,
    };
  `)
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))
// The sidebar's brand lockup as drawn: sizes in CSS px, colours, and whether the
// bundled wordmark loaded and still names the app.
const lockup = (app: AppSession) =>
  app.execute(`
    const tile = document.querySelector('nav .brand .astral-tile');
    const emblem = tile.querySelector('svg');
    const wordmark = document.querySelector('nav .brand img');
    const [t, e, w] = [tile, emblem, wordmark].map(el => el.getBoundingClientRect());
    const round = n => Math.round(n * 10) / 10;
    return {
      tile: [round(t.width), round(t.height)],
      radius: getComputedStyle(tile).borderTopLeftRadius,
      background: getComputedStyle(tile).backgroundColor,
      emblem: [round(e.width / t.width), getComputedStyle(emblem).color],
      gap: round(w.left - t.right),
      wordmark: [round(w.height), round(w.width), wordmark.alt, wordmark.naturalWidth > 0],
      centred: Math.abs((t.top + t.bottom) / 2 - (w.top + w.bottom) / 2) < 0.5,
    };
  `)

// Native integration test; run inside Xvfb. No production test hooks or mocked runtime.
test('the bundled native shell works offline, supports keyboard navigation, and closes cleanly', async () => {
  const app = await launch('astral-index', environment())
  try {
    // Inspect the real webview through its active native session.
    expect(await app.execute('return location.protocol')).toBe('tauri:')
    expect(await app.execute('return document.title')).toBe('Astral Index')
    // Without ASTRAL_INDEX_SIZE_OVERLAY, no size overlay is shown.
    expect(await app.execute('return document.querySelector(".size-overlay") === null')).toBe(true)
    // The first screen renders once the router resolves, and its empty state once the
    // saved history has been read, so wait for each rather than reading once.
    await expect.poll(() => heading(app), { timeout: 10000 }).toBe('Warp History')
    await expect
      .poll(() => textOf(app, '[role=status]'), { timeout: 10000 })
      .toContain('No Warp History Yet')
    await app.executeAsync('document.fonts.ready.then(() => arguments[arguments.length - 1]())')
    await app.screenshot('e2e-history')
    // The sidebar shows the brand lockup from the bundled files, sized from the
    // wordmark's height: an 18 px wordmark, a 2.4× tile, a 0.7× gap, a 110% emblem.
    expect(await lockup(app)).toEqual({
      tile: [43.2, 43.2],
      radius: '21%',
      background: 'rgb(32, 39, 53)',
      emblem: [1.1, 'rgb(250, 249, 245)'],
      gap: 12.6,
      wordmark: [18, 130, 'Astral Index', true],
      centred: true,
    })
    // The expanded sidebar shows its links' names, so their tooltips stay hidden.
    const importLink = 'nav a[aria-label=Import]'
    expect(
      await app.execute(
        `return getComputedStyle(document.querySelector("${importLink} .text")).display`,
      ),
    ).not.toBe('none')
    await app.hover(importLink)
    await pause(600)
    expect(await tooltipFor(app, importLink)).toMatchObject({ text: 'Import', shown: false })
    await app.hover('h1')
    // The sidebar works from the keyboard: Enter on the Import link opens that screen.
    await app.execute('document.querySelector("nav a[aria-label=Import]").focus()')
    await app.press(ENTER)
    await expect.poll(() => heading(app), { timeout: 5000 }).toBe('Import')
    await app.screenshot('e2e-import')
    expect(await app.execute('return document.documentElement.scrollWidth <= innerWidth')).toBe(
      true,
    )
    // The bundled typeface loads offline and styles the page (decision 0013).
    const font = await app.executeAsync(`
      const done = arguments[arguments.length - 1];
      document.fonts.ready.then(() => done({
        family: getComputedStyle(document.body).fontFamily.split(',')[0].trim(),
        loaded: [...document.fonts].some(
          face => face.family.includes('Hanken Grotesk') && face.status === 'loaded'),
      }));
    `)
    expect(font).toEqual({ family: '"Hanken Grotesk Variable"', loaded: true })
    // The window never shrinks below the 480×560 design minimum (decision 0013).
    await app.command('/window/rect', 'POST', { width: 320, height: 320 })
    expect(await app.execute('return { width: innerWidth, height: innerHeight }')).toEqual({
      width: 480,
      height: 560,
    })
    // Collapsed, the sidebar shows the tile alone; the hidden wordmark still names the app.
    expect(await lockup(app)).toMatchObject({
      tile: [32, 32],
      emblem: [1.1, 'rgb(250, 249, 245)'],
      wordmark: [1, 1, 'Astral Index', true],
    })
    // Collapsed to icons, the sidebar names its links in themed tooltips (decision 0013):
    // after a pause under the pointer, beside the link and inside the window.
    await app.hover(importLink)
    await expect
      .poll(() => tooltipFor(app, importLink), { timeout: 5000 })
      .toEqual({ text: 'Import', shown: true, inWindow: true, overlaps: false })
    // Escape hides it without moving the pointer.
    await app.press(ESCAPE)
    await expect.poll(async () => (await tooltipFor(app, importLink)).shown).toBe(false)
    // Tabbing onto a link shows its tooltip too, with the pointer elsewhere.
    await app.hover('h1')
    await app.execute(`document.querySelector("nav a[aria-label='Warp History']").focus()`)
    await app.press(TAB)
    expect(await app.execute('return document.activeElement.getAttribute("aria-label")')).toBe(
      'Import',
    )
    await expect
      .poll(() => tooltipFor(app, importLink), { timeout: 5000 })
      .toEqual({ text: 'Import', shown: true, inWindow: true, overlaps: false })
    // File import is coming soon: its button stays focusable, and its tooltip says why.
    const fileImport = '[aria-labelledby=source-file] button'
    await app.hover(fileImport)
    await expect
      .poll(() => tooltipFor(app, fileImport), { timeout: 5000 })
      .toEqual({
        text: 'Importing from a file isn’t available yet.',
        shown: true,
        inWindow: true,
        overlaps: false,
      })
    await app.screenshot('e2e-tooltip')
    await app.hover('h1')
    const network = await app.executeAsync(`
      const done = arguments[arguments.length - 1];
      const timeout = setTimeout(() => done(null), 1000);
      document.addEventListener('securitypolicyviolation', event => {
        clearTimeout(timeout);
        done({ directive: event.effectiveDirective, disposition: event.disposition });
      }, { once: true });
      fetch('http://127.0.0.1:43199/csp-probe').catch(() => {});
    `)
    expect(network, 'CSP must block webview connections').toEqual({
      directive: 'connect-src',
      disposition: 'enforce',
    })
    // The capability grants only the manifest commands; results carry categories, never contexts.
    const commands = await app.executeAsync<string[]>(`
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI_INTERNALS__.invoke;
      Promise.all([
        invoke('extract_from_file', new TextEncoder().encode('no request')).then(() => 'resolved', JSON.stringify),
        invoke('read_arbitrary_file').then(() => 'resolved', String),
        invoke('cancel_acquisition').then(() => 'resolved', String),
        invoke('retrieve_history', {
          mode: 'full',
          onProgress: '__CHANNEL__:' + window.__TAURI_INTERNALS__.transformCallback(() => {}),
        }).then(() => 'resolved', JSON.stringify),
        invoke('retrieve_history', {
          mode: 'partial',
          onProgress: '__CHANNEL__:' + window.__TAURI_INTERNALS__.transformCallback(() => {}),
        }).then(() => 'resolved', JSON.stringify),
        invoke('commit_import').then(() => 'resolved', JSON.stringify),
        invoke('discard_import').then(() => 'resolved', String),
        invoke('history_page', { category: '99', page: 1, pageSize: 20 }).then(() => 'resolved', JSON.stringify),
      ]).then(done);
    `)
    expect(commands[0]).toBe('{"kind":"no_request"}')
    expect(commands[1]).toContain('not allowed')
    expect(commands[2]).toBe('resolved')
    // Setup managed the database; nothing was validated, so nothing is retrieved.
    expect(commands[3]).toBe('{"kind":"no_context"}')
    // An unknown retrieval mode is refused before anything else.
    expect(commands[4]).toBe('{"kind":"invalid_request"}')
    // Nothing was retrieved, so nothing can be committed; discarding is harmless.
    expect(commands[5]).toBe('{"kind":"no_preview"}')
    expect(commands[6]).toBe('resolved')
    // Stored history is readable through the capability; bad requests are refused.
    expect(commands[7]).toBe('{"kind":"invalid_request"}')
    // Keyboard-operated automatic search fails safely here, then the real file input
    // sends a synthetic cache through raw IPC. Validation cannot reach HoYoverse offline.
    await app.execute('document.querySelector(".retrieval button").focus()')
    await app.press(ENTER)
    await expect
      .poll(() => textOf(app, '.failed'), { timeout: 10000 })
      .toContain('Automatic search needs Windows')
    await app.chooseFile('#retry-cache-file', cachePath)
    await expect
      .poll(() => textOf(app, '.failed'), { timeout: 10000 })
      .toContain('We couldn’t reach HoYoverse.')
    // The narrow window collapses the sidebar to icons.
    expect(
      await app.execute(
        'return getComputedStyle(document.querySelector("nav .local .text")).display',
      ),
    ).toBe('none')
    await app.screenshot('e2e-smoke')
    await app.close()
  } finally {
    await app.dispose()
  }
}, 60000)

// The mock debug binary answers from a synthetic HoYoverse (decision 0014), so the whole
// flow runs with no network. Its history goes to its own folder in a data home that
// starts fresh, unless `keep` relaunches it on the data saved so far, as a restart.
const mockData = resolve('test-results/mock-data')
async function launchMock(
  scenario: string,
  { env = {}, keep = false }: { env?: NodeJS.ProcessEnv; keep?: boolean } = {},
) {
  if (!keep) rmSync(mockData, { recursive: true, force: true })
  // A module cached by an earlier run, which the mock must not reuse.
  const staleCache = resolve(mockData, 'astral-index-mock/webview/WebKitCache/stale-module')
  mkdirSync(resolve(staleCache, '..'), { recursive: true })
  writeFileSync(staleCache, 'cached before a refactor')
  const app = await launch(
    'astral-index-mock',
    environment({ XDG_DATA_HOME: mockData, ASTRAL_INDEX_MOCK_SCENARIO: scenario, ...env }),
  )
  return {
    app,
    database: resolve(mockData, 'astral-index-mock/history.sqlite'),
    staleCache,
  }
}
/** Run `steps` in the mock, then close it as a user would. */
async function withMock(
  scenario: string,
  options: Parameters<typeof launchMock>[1],
  steps: (app: AppSession, database: string) => Promise<void>,
) {
  const { app, database } = await launchMock(scenario, options)
  try {
    await steps(app, database)
    await app.close()
  } finally {
    await app.dispose()
  }
}
/** The files under the mock's data home, its webview profile included, holding the auth key. */
const filesHoldingAuthKey = () =>
  readdirSync(mockData, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => readFileSync(path).includes(authKey))
/** The stored account and every category's count, read without retrieving. */
async function stored(app: AppSession) {
  const page = await app.executeAsync<{
    account: { uid: string } | null
    categories: { gacha_type: string; total: number }[]
  }>(
    `window.__TAURI_INTERNALS__.invoke('history_page', { category: '11', page: 1, pageSize: 20 }).then(arguments[arguments.length - 1])`,
  )
  return {
    uid: page.account?.uid ?? null,
    totals: Object.fromEntries(
      page.categories.map((category) => [category.gacha_type, category.total]),
    ),
  }
}
// No account yet, and an empty count for every category.
const nothingSaved = {
  uid: null,
  totals: { '1': 0, '2': 0, '11': 0, '12': 0, '21': 0, '22': 0 },
}
// The mock's full history, as `stored` reads it (decision 0014).
const savedHistory = {
  uid: '100000001',
  totals: { '1': 300, '2': 50, '11': 1250, '12': 412, '21': 38, '22': 10 },
}
/**
 * Each stored account, rolls or not, with its roll count and a digest of its rows, read from the closed
 * mock's database file, so a later import can be shown to leave them unchanged.
 */
function storedAccounts() {
  const database = new DatabaseSync(resolve(mockData, 'astral-index-mock/history.sqlite'), {
    readOnly: true,
  })
  try {
    const rows = database
      .prepare('SELECT uid, server, id, payload, first_batch FROM rolls ORDER BY uid, server, id')
      .all() as { uid: string; server: string; id: string; payload: string; first_batch: number }[]
    const stored = database
      .prepare('SELECT uid, server FROM accounts ORDER BY uid, server')
      .all() as {
      uid: string
      server: string
    }[]
    const accounts: Record<string, { rolls: number; digest: string }> = {}
    for (const account of stored.map((row) => `${row.uid} ${row.server}`)) {
      const own = rows.filter((row) => `${row.uid} ${row.server}` === account)
      accounts[account] = {
        rolls: own.length,
        digest: createHash('sha256').update(JSON.stringify(own)).digest('hex'),
      }
    }
    return accounts
  } finally {
    database.close()
  }
}
/** Ask, as the webview could, to retrieve and to save, outside the import flow. */
const retrieveAndSave = (app: AppSession) =>
  app.executeAsync<string[]>(`
    const done = arguments[arguments.length - 1];
    const invoke = window.__TAURI_INTERNALS__.invoke;
    Promise.all([
      invoke('retrieve_history', {
        mode: 'new',
        onProgress: '__CHANNEL__:' + window.__TAURI_INTERNALS__.transformCallback(() => {}),
      }).then(() => 'resolved', JSON.stringify),
      invoke('commit_import').then(() => 'resolved', JSON.stringify),
    ]).then(done);
  `)
// Without a validated link nothing is retrieved, and without a review nothing is saved.
const refused = ['{"kind":"no_context"}', '{"kind":"no_preview"}']
async function retrieveFromFile(app: AppSession) {
  // The first screen renders once the router has resolved it.
  await expect.poll(() => heading(app), { timeout: 10000 }).toBe('Warp History')
  await app.execute('document.querySelector("nav a[aria-label=Import]").click()')
  await expect.poll(() => heading(app), { timeout: 5000 }).toBe('Import')
  await app.chooseFile('#cache-file', cachePath)
}
const skipped = (app: AppSession) =>
  app.execute<string | undefined>(
    'return [...document.querySelectorAll(".review .stat")].find(stat => stat.querySelector(".stat-label").textContent === "Existing rolls skipped")?.querySelector(".stat-value").textContent',
  )
const click = (app: AppSession, container: string, name: string) =>
  app.execute(
    `[...document.querySelectorAll("${container} button")].find(b => b.textContent.trim() === ${JSON.stringify(name)}).click()`,
  )

test('the mock binary retrieves, reviews and saves synthetic history, which persists', async () => {
  const { app, database, staleCache } = await launchMock('history')
  try {
    await retrieveFromFile(app)
    // The mock started with a fresh webview profile.
    expect(existsSync(staleCache)).toBe(false)
    await expect
      .poll(() => textOf(app, '.progress [role=status]'), { timeout: 10000 })
      .toContain('Retrieving')
    // The download shows the category reached and each category's state.
    await expect
      .poll(() => textOf(app, '.progress .summary'), { timeout: 10000 })
      .toMatch(/^Category [1-6] of 6\s*[\d,]+ rolls? so far$/)
    expect(
      await app.execute(
        'return [...document.querySelectorAll(".categories .name")].map(name => name.textContent)',
      ),
    ).toEqual([
      'Stellar Warp',
      'Departure Warp',
      'Character Event Warp',
      'Light Cone Event Warp',
      'Character Collaboration Warp',
      'Light Cone Collaboration Warp',
    ])
    await app.screenshot('e2e-mock-progress')
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 30000 })
      .toBe('Ready to save 2,060 new rolls')
    expect(await heading(app)).toBe('Review Import')
    expect(await textOf(app, '.review .account')).toContain('100000001')
    // The mock's prod_official_asia server reads as the game names it.
    expect(await textOf(app, '.review .account .chip')).toBe('Asia')
    await app.screenshot('e2e-mock-review')
    await click(app, '.review', 'Save 2,060 rolls')
    await expect.poll(() => textOf(app, '.saved h2'), { timeout: 10000 }).toBe('2,060 Rolls Saved')
    expect(await textOf(app, '.saved p')).toBe('Added to UID 100000001 (Asia).')
    // The mock's history has 32 five-star and 206 four-star rows (decision 0014).
    expect(
      await app.execute(
        'return [...document.querySelectorAll(".saved .stat-value")].map(value => value.textContent)',
      ),
    ).toEqual(['32', '206', '0'])
    // The saved history reads back a page at a time, newest first, never fetching.
    const history = (page: number) =>
      app.executeAsync<{
        account: { uid: string }
        total: number
        categories: { gacha_type: string; total: number }[]
        rolls: { number: number; id: string; time: string; rank_type: string }[]
      }>(
        `window.__TAURI_INTERNALS__.invoke('history_page', { category: '11', page: ${page}, pageSize: 20 }).then(arguments[arguments.length - 1])`,
      )
    const first = await history(1)
    expect([first.account.uid, first.total, first.rolls.length]).toEqual(['100000001', 1250, 20])
    // Each page also counts every category, as the mock serves them.
    expect(first.categories).toEqual(
      [
        ['1', 300],
        ['2', 50],
        ['11', 1250],
        ['12', 412],
        ['21', 38],
        ['22', 10],
      ].map(([gacha_type, total]) => ({ gacha_type, total })),
    )
    expect(first.rolls[0]).toEqual(
      expect.objectContaining({
        number: 1250,
        id: '1800000000110000000',
        time: '2026-09-28 21:03:03',
      }),
    )
    const last = await history(63)
    expect(last.rolls.map((roll) => roll.number)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    await app.screenshot('e2e-mock-saved')
    expect(existsSync(database)).toBe(true)
    // The History screen shows what was saved, read from this device.
    await app.execute(
      `[...document.querySelectorAll(".saved a")].find(a => a.textContent.trim() === "View warp history").click()`,
    )
    await expect.poll(() => heading(app), { timeout: 10000 }).toBe('Warp History')
    await expect
      .poll(() => textOf(app, '.showing'), { timeout: 10000 })
      .toMatch(/^\s*Showing 1–20 of\s+1,250\s*$/)
    expect(
      await app.execute('return document.querySelector(".account").getAttribute("aria-label")'),
    ).toBe('Account: UID 100000001, Asia server')
    // In a wide window the tabs show their counts.
    await app.command('/window/rect', 'POST', { width: 1280, height: 900 })
    const tabs = () =>
      app.execute<string[]>(
        `return [...document.querySelectorAll('[aria-label="Banner category"] button')].map(tab => tab.textContent.replace(/\\s+/g, " ").trim())`,
      )
    await expect
      .poll(tabs, { timeout: 5000 })
      .toEqual([
        'Character Event 1,250',
        'Light Cone Event 412',
        'Stellar 300',
        'Departure 50',
        'Character Collab 38',
        'Light Cone Collab 10',
      ])
    expect(await textOf(app, '[aria-sort]')).toBe('Time (UTC+8)')
    expect(
      await app.execute(
        `return [...document.querySelectorAll(".roll-list .body [role=row]")].slice(0, 2).map(row => [...row.querySelectorAll("[role=cell]")].map(cell => cell.textContent.trim()).filter((_, index) => index !== 1))`,
      ),
    ).toEqual([
      [
        '1250',
        expect.stringMatching(/^\d+$/),
        expect.stringMatching(/^[345]★$/),
        expect.any(String),
        '28 Sep 2026, 21:03:03',
      ],
      [
        '1249',
        expect.stringMatching(/^\d+$/),
        expect.stringMatching(/^[345]★$/),
        expect.any(String),
        '28 Sep 2026, 21:03:03',
      ],
    ])
    // Each roll's pity counts on from the older roll below it, starting again at 1
    // straight after a 5★.
    const pities = await app.execute<{ pity: number; five: boolean; band: string | null }[]>(
      `return [...document.querySelectorAll(".roll-list .body [role=row]")].map(row => { const cell = row.querySelector(".pity"); return { pity: Number(cell.firstChild.textContent), five: row.classList.contains("rarity-5"), band: [...cell.classList].find(name => name.startsWith("band-")) ?? null } })`,
    )
    // Character Event Warp's 5★ pity turns orange from 49 and red from 74; the rest
    // stay plain.
    expect(pities.some((roll) => roll.five)).toBe(true)
    for (const roll of pities) {
      const band = roll.pity >= 74 ? 'band-soft' : roll.pity >= 49 ? 'band-near' : 'band-early'
      expect(roll.band).toBe(roll.five ? band : null)
    }
    expect(pities).toHaveLength(20)
    for (const [newer, older] of pities
      .slice(0, -1)
      .map((roll, index) => [roll, pities[index + 1]])) {
      expect(newer.pity).toBe(older.five ? 1 : older.pity + 1)
    }
    // The summary strip covers the whole category: each rate is its count's share of
    // the 1,250 rolls, and the period ends on the newest roll's date.
    const strip = await app.execute<{ label: string; parts: string[] }[]>(
      `return [...document.querySelectorAll('[aria-label="Category summary"] .tile')].map(tile => ({ label: tile.querySelector(".label").textContent, parts: [...tile.querySelectorAll(".value, .rate, .period > span")].map(part => part.textContent.trim()) }))`,
    )
    expect(strip.map((tile) => tile.label)).toEqual([
      'Rolls stored',
      '5★ rolls',
      '4★ rolls',
      'Stored period',
    ])
    expect(strip[0].parts).toEqual(['1,250'])
    for (const tile of [strip[1], strip[2]]) {
      const [count, shown] = tile.parts
      expect(Number(count)).toBeGreaterThan(0)
      expect(shown).toBe(`${((Number(count) / 1250) * 100).toFixed(2)}%`)
    }
    expect(strip[3].parts.slice(1)).toEqual([
      expect.stringMatching(/^\d{1,2} [A-Z][a-z]{2} \d{4} –$/),
      '28 Sep 2026',
    ])
    // Hiding 3★ rolls leaves the 5★ and 4★ ones of the whole category, still numbered
    // in it, while the tabs and strip keep counting everything.
    const fiveAndFour = Number(strip[1].parts[0]) + Number(strip[2].parts[0])
    await app.execute(`document.querySelector('[aria-label="Show rarities"] .rarity-3').click()`)
    await expect
      .poll(async () => (await textOf(app, '.showing'))?.replace(/\s+/g, ' ').trim(), {
        timeout: 10000,
      })
      .toBe(`Showing 1–20 of ${fiveAndFour}`)
    const filtered = await app.execute<string[][]>(
      `return [...document.querySelectorAll(".roll-list .body [role=row]")].map(row => [...row.querySelectorAll("[role=cell]")].map(cell => cell.textContent.trim()))`,
    )
    expect(filtered).toHaveLength(20)
    expect(filtered.every((cells) => /^[45]★$/.test(cells[3]))).toBe(true)
    expect(Number(filtered[0][0])).toBeLessThanOrEqual(1250)
    expect(filtered.map((cells) => Number(cells[0]))).toEqual(
      filtered.map((cells) => Number(cells[0])).toSorted((a, b) => b - a),
    )
    expect(await textOf(app, "[aria-label='Category summary'] .tile .value")).toBe('1,250')
    await app.screenshot('e2e-mock-history-filtered')
    // Typing a lowercase search narrows the 5★ and 4★ rolls to that item, once
    // typing pauses, still numbered in the whole category.
    await app.execute('document.querySelector(\'input[type="search"]\').focus()')
    await app.press(...'acheron')
    await expect
      .poll(
        () =>
          app.execute<string[]>(
            `return [...document.querySelectorAll(".roll-list .body [role=row] .name")].map(name => name.textContent.trim())`,
          ),
        { timeout: 10000 },
      )
      .toSatisfy((names: string[]) => names.length > 0 && names.every((name) => name === 'Acheron'))
    const searched = Number(
      (await textOf(app, '.showing'))?.replace(/\s+/g, ' ').match(/of ([\d,]+)$/)?.[1],
    )
    expect(searched).toBeGreaterThan(0)
    expect(searched).toBeLessThan(fiveAndFour)
    await app.screenshot('e2e-mock-history-search')
    await app.execute(
      `const box = document.querySelector('input[type="search"]'); box.value = ''; box.dispatchEvent(new Event('input'))`,
    )
    // With the keyboard, the date button opens its popover at All dates; choosing
    // 28 Sep onwards keeps only that day's 5★ and 4★ rolls, and Escape closes it.
    await app.execute('document.querySelector(\'button[aria-haspopup="dialog"]\').focus()')
    await app.press(ENTER)
    await expect
      .poll(
        () => app.execute<string | undefined>('return document.activeElement?.textContent?.trim()'),
        {
          timeout: 10000,
        },
      )
      .toBe('All dates')
    expect(await textOf(app, '[role=dialog] .note')).toBe(
      'Server time (UTC+8). Saved rolls span 25 Sep 2026 – 28 Sep 2026.',
    )
    await app.execute(
      `const from = [...document.querySelectorAll('[role=dialog] label')].find(label => label.textContent.trim() === 'From').querySelector('input'); from.value = '2026-09-28'; from.dispatchEvent(new Event('change'))`,
    )
    await expect
      .poll(
        () =>
          app.execute<string[]>(
            `return [...document.querySelectorAll(".roll-list .body [role=row]")].map(row => row.lastElementChild.textContent.trim().slice(0, 11))`,
          ),
        { timeout: 10000 },
      )
      .toSatisfy((days: string[]) => days.length > 0 && days.every((day) => day === '28 Sep 2026'))
    await app.screenshot('e2e-mock-history-dates')
    await app.press(ESCAPE)
    await expect
      .poll(() => textOf(app, "button[aria-haspopup='dialog']"), { timeout: 10000 })
      .toMatch(/^\s*From 28 Sep 2026\s*$/)
    expect(await app.execute('return document.querySelector("[role=dialog]") === null')).toBe(true)
    expect(
      await app.execute(
        'return document.activeElement === document.querySelector(\'button[aria-haspopup="dialog"]\')',
      ),
    ).toBe(true)
    await app.press(ENTER)
    await expect.poll(() => textOf(app, '[role=dialog] .clear'), { timeout: 10000 }).toBe('Clear')
    await app.execute('document.querySelector("[role=dialog] .clear").click()')
    await app.press(ESCAPE)
    await app.execute(`document.querySelector('[aria-label="Show rarities"] .rarity-3').click()`)
    await expect
      .poll(() => textOf(app, '.showing'), { timeout: 10000 })
      .toMatch(/^\s*Showing 1–20 of\s+1,250\s*$/)
    await app.screenshot('e2e-mock-history')
    // With room to spare, the rolls scroll inside their panel and the screen does not.
    expect(
      await app.execute(
        'const main = document.querySelector("main .body"); return main.scrollHeight <= main.clientHeight',
      ),
    ).toBe(true)
    // The Grid layout shows the same page as tiles, several to a row, from the keyboard.
    // The toolbar keeps its height above the rolls, however many rows it wraps to.
    const toolbarClear = () =>
      app.execute<boolean>(`
        const controls = [...document.querySelector('.rolls .toolbar').children];
        const rolls = document.querySelector('.roll-list, .roll-grid').getBoundingClientRect();
        return Math.max(...controls.map(control => control.getBoundingClientRect().bottom)) <= rolls.top + 1;
      `)
    const grid = () =>
      app.execute<{ tiles: number; columns: number; narrowest: number; fits: boolean }>(`
        const tiles = [...document.querySelectorAll('.roll-grid li')];
        return {
          tiles: tiles.length,
          columns: new Set(tiles.map(tile => tile.getBoundingClientRect().left)).size,
          narrowest: Math.min(...tiles.map(tile => tile.getBoundingClientRect().width)),
          fits: document.documentElement.scrollWidth <= innerWidth,
        };
      `)
    await app.execute('document.querySelector(\'[aria-label="Grid view"]\').focus()')
    await app.press(ENTER)
    await expect.poll(async () => (await grid()).tiles, { timeout: 5000 }).toBe(20)
    const wide = await grid()
    expect(wide.columns).toBeGreaterThan(2)
    expect(wide.narrowest).toBeGreaterThanOrEqual(190)
    expect(wide.fits).toBe(true)
    await app.screenshot('e2e-mock-history-grid')
    // The Icons layout is one Tab stop: arrows move by icon and by row, and each icon
    // names its roll in a tooltip and to assistive technology.
    await app.execute('document.querySelector(\'[aria-label="Icons view"]\').focus()')
    await app.press(ENTER)
    await expect
      .poll(
        () => app.execute('return document.querySelectorAll(".roll-icons [role=img]").length'),
        {
          timeout: 5000,
        },
      )
      .toBe(20)
    const focusedIcon = () =>
      app.execute<{ index: number; label: string; tip: string; shown: boolean }>(`
        const icons = [...document.querySelectorAll('.roll-icons [role=img]')];
        const icon = document.activeElement;
        const tip = icon.parentElement.querySelector('[role=tooltip]');
        return {
          index: icons.indexOf(icon),
          label: icon.getAttribute('aria-label'),
          tip: tip?.textContent,
          shown: tip !== null && getComputedStyle(tip).display !== 'none',
        };
      `)
    await app.press(TAB)
    await expect.poll(focusedIcon, { timeout: 5000 }).toMatchObject({ index: 0, shown: true })
    const firstIcon = await focusedIcon()
    expect(firstIcon.tip).toBe(firstIcon.label)
    expect(firstIcon.label).toMatch(/^.+, [345]★, pity \d+, #1250, \d+ \w{3} \d{4}$/)
    await app.press(RIGHT)
    expect((await focusedIcon()).index).toBe(1)
    const perRow = await app.execute<number>(`
      const icons = [...document.querySelectorAll('.roll-icons [role=img]')];
      return icons.filter(icon => icon.offsetTop === icons[0].offsetTop).length;
    `)
    expect(perRow).toBeGreaterThan(1)
    await app.press(DOWN)
    expect((await focusedIcon()).index).toBe(1 + perRow)
    await app.screenshot('e2e-mock-history-icons')
    await app.execute('document.querySelector(\'[aria-label="List view"]\').click()')
    await expect
      .poll(() => app.execute('return document.querySelector(".roll-list") !== null'), {
        timeout: 5000,
      })
      .toBe(true)
    // At the minimum width they no longer fit, so they become a dropdown.
    await app.command('/window/rect', 'POST', { width: 480, height: 700 })
    await expect
      .poll(() => textOf(app, 'label.select select option:checked'), { timeout: 5000 })
      .toMatch(/^\s*Character Event · 1,250\s*$/)
    expect(await tabs()).toEqual([])
    // The strip wraps to two by two rather than squashing.
    expect(
      await app.execute<number>(
        `return new Set([...document.querySelectorAll('[aria-label="Category summary"] .tile')].map(tile => tile.getBoundingClientRect().top)).size`,
      ),
    ).toBe(2)
    expect(await toolbarClear()).toBe(true)
    // In a short window the rolls keep room for a few rows, and the screen scrolls instead.
    const rollsHeight = () =>
      app.execute<number>(
        'return document.querySelector(".roll-list, .roll-grid").getBoundingClientRect().height',
      )
    expect(await rollsHeight()).toBeGreaterThanOrEqual(200)
    // The screen scrolls down only, never sideways.
    expect(
      await app.execute(
        'const main = document.querySelector("main .body"); return main.scrollWidth <= main.clientWidth',
      ),
    ).toBe(true)
    // Item icons keep their 30px size in the list's rows.
    expect(
      await app.execute(
        'const icon = document.querySelector(".roll-list .body .icon").getBoundingClientRect(); return [icon.width, icon.height]',
      ),
    ).toEqual([30, 30])
    await app.screenshot('e2e-mock-history-narrow')
    // Narrow, the grid keeps whole tiles, fewer to a row, without scrolling sideways.
    await app.execute('document.querySelector(\'[aria-label="Grid view"]\').click()')
    await expect.poll(async () => (await grid()).tiles, { timeout: 5000 }).toBe(20)
    const narrow = await grid()
    expect(narrow.columns).toBeLessThan(wide.columns)
    expect(narrow.narrowest).toBeGreaterThanOrEqual(190)
    expect(narrow.fits).toBe(true)
    expect(await toolbarClear()).toBe(true)
    expect(await rollsHeight()).toBeGreaterThanOrEqual(200)
    await app.screenshot('e2e-mock-history-grid-narrow')
    // Paging reads the next rolls, still from this device.
    await app.execute('document.querySelector(\'[aria-label="Next page"]\').click()')
    await expect
      .poll(() => textOf(app, '.showing'), { timeout: 10000 })
      .toMatch(/^\s*Showing 21–40 of\s+1,250\s*$/)
    // A second retrieval finds everything already saved.
    await app.execute('document.querySelector("nav a[aria-label=Import]").click()')
    await expect.poll(() => heading(app), { timeout: 5000 }).toBe('Import')
    // The Import screen now names the import just saved.
    await app.command('/window/rect', 'POST', { width: 1280, height: 900 })
    const lastImport = () =>
      app.execute<string[]>(
        'return [...document.querySelectorAll(".last-import .part")].map(part => part.textContent)',
      )
    await expect
      .poll(async () => (await lastImport()).slice(1), { timeout: 5000 })
      .toEqual(['Retrieved from HoYoverse', 'UID 100000001 (Asia)', '2,060 new rolls saved'])
    expect((await lastImport())[0]).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/)
    await app.screenshot('e2e-mock-last-import')
    // A quick refresh, the default, stops each category at its first page: every
    // category reaches saved rolls there, so only those pages are skipped.
    await app.chooseFile('#cache-file', cachePath)
    await expect
      .poll(
        () =>
          app.execute<number>(
            'return document.querySelectorAll(".categories [data-state=up-to-date]").length',
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0)
    await app.screenshot('e2e-mock-refresh-progress')
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 30000 })
      .toBe('Everything here is already saved')
    // Stellar 300, Departure 50, Character Event 1,000, Light Cone Event 412 and
    // the two collaboration warps' first 20 and 10.
    expect(await skipped(app)).toBe('1,792')
    await click(app, '.review', 'Done')
    await expect
      .poll(() => textOf(app, '.start .note'), { timeout: 10000 })
      .toContain('Your saved history is already up to date.')
    // The full history still requests every page, skipping every saved roll.
    await app.execute(
      '[...document.querySelectorAll("fieldset label")].find(label => label.textContent.trim() === "Full history").click()',
    )
    await app.chooseFile('#cache-file', cachePath)
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 60000 })
      .toBe('Everything here is already saved')
    expect(await skipped(app)).toBe('2,060')
    await click(app, '.review', 'Done')
    await app.close()
  } finally {
    await app.dispose()
  }
}, 120000)

test('failed, cancelled and discarded retrievals save nothing, and saved history survives restarts and later failures', async () => {
  // A retrieval that loses the network says where it stopped and saves nothing.
  await withMock('network-failure', {}, async (app, database) => {
    await retrieveFromFile(app)
    await expect
      .poll(() => textOf(app, '.failed h2'), { timeout: 30000 })
      .toBe('Couldn’t Reach HoYoverse')
    expect(await textOf(app, '.failed')).toContain(
      'Retrieval stopped at Light Cone Event Warp, page 1.',
    )
    await app.screenshot('e2e-mock-failed')
    // The History screen's read opens the database, but no rolls were saved.
    expect(existsSync(database)).toBe(true)
    expect(await stored(app)).toEqual(nothingSaved)
  })
  // Once HoYoverse answers again, a cancelled retrieval and a discarded review save
  // nothing either, and a retrieval saves everything the failed one could not.
  await withMock('history', { keep: true }, async (app) => {
    await retrieveFromFile(app)
    await expect
      .poll(() => textOf(app, '.progress .summary'), { timeout: 10000 })
      .toMatch(/^Category [1-6] of 6/)
    await click(app, '.progress', 'Cancel')
    await expect
      .poll(() => textOf(app, '.start .note'), { timeout: 10000 })
      .toBe('Retrieval cancelled. Nothing was saved.')
    expect(await stored(app)).toEqual(nothingSaved)
    await app.chooseFile('#cache-file', cachePath)
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 30000 })
      .toBe('Ready to save 2,060 new rolls')
    await click(app, '.review', 'Discard')
    await expect
      .poll(() => textOf(app, '.start .note'), { timeout: 10000 })
      .toBe('Discarded the retrieved history. Nothing was saved.')
    expect(await stored(app)).toEqual(nothingSaved)
    await app.chooseFile('#cache-file', cachePath)
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 30000 })
      .toBe('Ready to save 2,060 new rolls')
    await click(app, '.review', 'Save 2,060 rolls')
    await expect.poll(() => textOf(app, '.saved h2'), { timeout: 10000 }).toBe('2,060 Rolls Saved')
    expect(await stored(app)).toEqual(savedHistory)
  })
  // After a restart, the saved history shows straight away, read from this device.
  await withMock('network-failure', { keep: true }, async (app) => {
    await expect.poll(() => heading(app), { timeout: 10000 }).toBe('Warp History')
    await expect
      .poll(() => textOf(app, '.showing'), { timeout: 10000 })
      .toMatch(/^\s*Showing 1–20 of\s+1,250\s*$/)
    expect(
      await app.execute('return document.querySelector(".account").getAttribute("aria-label")'),
    ).toBe('Account: UID 100000001, Asia server')
    await app.screenshot('e2e-mock-restart')
    await app.execute('document.querySelector("nav a[aria-label=Import]").click()')
    await expect.poll(() => heading(app), { timeout: 5000 }).toBe('Import')
    await app.command('/window/rect', 'POST', { width: 1280, height: 900 })
    await expect
      .poll(
        () =>
          app.execute<string[]>(
            'return [...document.querySelectorAll(".last-import .part")].slice(1).map(part => part.textContent)',
          ),
        { timeout: 5000 },
      )
      .toEqual(['Retrieved from HoYoverse', 'UID 100000001 (Asia)', '2,060 new rolls saved'])
    // A retrieval that fails now leaves the saved history as it was.
    await app.chooseFile('#cache-file', cachePath)
    await expect
      .poll(() => textOf(app, '.failed h2'), { timeout: 30000 })
      .toBe('Couldn’t Reach HoYoverse')
    expect(await stored(app)).toEqual(savedHistory)
  })
  // Saving, failing and cancelling never wrote the auth key anywhere the app keeps data.
  expect(filesHoldingAuthKey()).toEqual([])
}, 180000)

test('a quick refresh saves only newer rolls, and another account with the same roll IDs is kept apart', async () => {
  const save = async (app: AppSession, rolls: string) => {
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 60000 })
      .toBe(`Ready to save ${rolls} new rolls`)
    await click(app, '.review', `Save ${rolls} rolls`)
    await expect
      .poll(() => textOf(app, '.saved h2'), { timeout: 10000 })
      .toBe(`${rolls} Rolls Saved`)
  }
  await withMock('history', {}, async (app) => {
    await retrieveFromFile(app)
    await save(app, '2,060')
  })
  // The same account has since made 25 more rolls in each category.
  await withMock('newer-history', { keep: true }, async (app) => {
    await retrieveFromFile(app)
    // Each category's first page reaches saved rolls, except the collaboration warps',
    // whose 20-roll first pages hold only newer ones: their second pages hold 15 and
    // 10 saved rolls. Stellar 300, Departure 50, Character Event 975, Light Cone
    // Event 412 and those 25 are skipped.
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 60000 })
      .toBe('Ready to save 150 new rolls')
    expect(await skipped(app)).toBe('1,762')
    await save(app, '150')
    expect(await stored(app)).toEqual({
      uid: '100000001',
      totals: { '1': 325, '2': 75, '11': 1275, '12': 437, '21': 63, '22': 35 },
    })
    // The newer rolls are numbered on from the saved ones, newest first.
    await app.execute(
      `[...document.querySelectorAll(".saved a")].find(a => a.textContent.trim() === "View warp history").click()`,
    )
    await expect
      .poll(() => textOf(app, '.showing'), { timeout: 10000 })
      .toMatch(/^\s*Showing 1–20 of\s+1,275\s*$/)
    expect(
      await app.execute(
        `return [...document.querySelectorAll(".roll-list .body [role=row]")].map(row => row.querySelector("[role=cell]").textContent.trim())`,
      ),
    ).toEqual(Array.from({ length: 20 }, (_, index) => String(1275 - index)))
    await app.screenshot('e2e-mock-newer')
    // A full retrieval finds nothing new either.
    await app.execute('document.querySelector("nav a[aria-label=Import]").click()')
    await expect.poll(() => heading(app), { timeout: 5000 }).toBe('Import')
    await app.execute(
      '[...document.querySelectorAll("fieldset label")].find(label => label.textContent.trim() === "Full history").click()',
    )
    await app.chooseFile('#cache-file', cachePath)
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 60000 })
      .toBe('Everything here is already saved')
    expect(await skipped(app)).toBe('2,210')
    await click(app, '.review', 'Done')
  })
  const first = storedAccounts()
  expect(Object.keys(first)).toEqual(['100000001 prod_official_asia'])
  expect(first['100000001 prod_official_asia'].rolls).toBe(2210)
  // The same cache file now reaches another account, on another server, whose roll IDs
  // match the first account's. The account comes from HoYoverse's responses, and a
  // quick refresh only stops at the account's own saved rolls, so none are omitted.
  await withMock('second-account', { keep: true }, async (app) => {
    await retrieveFromFile(app)
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 60000 })
      .toBe('Ready to save 2,060 new rolls')
    expect(await textOf(app, '.review .account')).toContain('100000002')
    expect(await textOf(app, '.review .account .chip')).toBe('America')
    await save(app, '2,060')
    expect(await textOf(app, '.saved p')).toBe('Added to UID 100000002 (America).')
    // The History screen follows the account imported last, and now that two are
    // saved its header switches between them.
    expect(await stored(app)).toEqual({ ...savedHistory, uid: '100000002' })
    await app.execute('document.querySelector("nav a[aria-label=\'Warp History\']").click()')
    const switcherLabel = () =>
      app.execute<string | null>(
        'return document.querySelector("button[aria-haspopup=menu]")?.getAttribute("aria-label")',
      )
    await expect
      .poll(switcherLabel, { timeout: 10000 })
      .toBe('Switch account. Current: UID 100000002, America server')
    await app.screenshot('e2e-mock-second-account')
    // With the keyboard: open the menu at the current account, move to the other one
    // and choose it.
    await app.execute('document.querySelector("button[aria-haspopup=menu]").focus()')
    await app.press(DOWN)
    await expect
      .poll(
        () =>
          app.execute<string[]>(
            'return [...document.querySelectorAll("[role=menuitemradio]")].map((item) => [".uid", ".server", ".rolls"].map((part) => item.querySelector(part).textContent))',
          ),
        { timeout: 10000 },
      )
      .toEqual([
        ['100000002', 'America', '2,060 rolls'],
        ['100000001', 'Asia', '2,210 rolls'],
      ])
    await app.screenshot('e2e-mock-account-menu')
    await app.press(DOWN, ENTER)
    await expect
      .poll(switcherLabel, { timeout: 10000 })
      .toBe('Switch account. Current: UID 100000001, Asia server')
    // Its own Character Event Warp rolls, including the 25 the quick refresh added.
    await expect
      .poll(() => textOf(app, '.showing'), { timeout: 10000 })
      .toMatch(/^\s*Showing 1–20 of\s+1,275\s*$/)
  })
  // Pages that disagree on the account are refused as a whole.
  await withMock('mixed-accounts', { keep: true }, async (app) => {
    await retrieveFromFile(app)
    await expect
      .poll(() => textOf(app, '.failed h2'), { timeout: 60000 })
      .toBe('Retrieval Didn’t Finish')
    expect(await textOf(app, '.failed')).toContain(
      'Retrieval stopped at Light Cone Event Warp, page 1. HoYoverse returned history for more than one account, so nothing was kept.',
    )
    await app.screenshot('e2e-mock-mixed-accounts')
  })
  // Each account's rolls are stored apart, and the first account's are untouched.
  const accounts = storedAccounts()
  expect(Object.keys(accounts)).toEqual([
    '100000001 prod_official_asia',
    '100000002 prod_official_usa',
  ])
  expect(accounts['100000001 prod_official_asia']).toEqual(first['100000001 prod_official_asia'])
  expect(accounts['100000002 prod_official_usa'].rolls).toBe(2060)
}, 300000)

test('a retrieval with no history creates no account, and an ended retrieval’s link and review cannot be reused', async () => {
  await withMock('no-history', {}, async (app) => {
    // Before any retrieval there is nothing to retrieve with or to save.
    await expect.poll(() => heading(app), { timeout: 10000 }).toBe('Warp History')
    expect(await retrieveAndSave(app)).toEqual(refused)
    await retrieveFromFile(app)
    await expect
      .poll(() => textOf(app, '.start .note'), { timeout: 30000 })
      .toBe('HoYoverse returned no warp history for this account. Nothing was saved.')
    expect(await stored(app)).toEqual(nothingSaved)
    // The retrieval dropped its link when it ended, and left no review.
    expect(await retrieveAndSave(app)).toEqual(refused)
  })
  expect(storedAccounts()).toEqual({})
  await withMock('history', { keep: true }, async (app) => {
    await retrieveFromFile(app)
    await expect
      .poll(() => textOf(app, '.review h2'), { timeout: 60000 })
      .toBe('Ready to save 2,060 new rolls')
    await click(app, '.review', 'Save 2,060 rolls')
    await expect.poll(() => textOf(app, '.saved h2'), { timeout: 10000 }).toBe('2,060 Rolls Saved')
    // Saving used the review up, and the link went when the retrieval ended.
    expect(await retrieveAndSave(app)).toEqual(refused)
    expect(await stored(app)).toEqual(savedHistory)
  })
  expect(Object.keys(storedAccounts())).toEqual(['100000001 prod_official_asia'])
}, 120000)

test('a development zoom scales the webview, so WSL can match the Windows display scale', async () => {
  const { app } = await launchMock('no-history', {
    env: { ASTRAL_INDEX_ZOOM: '1.25', ASTRAL_INDEX_SIZE_OVERLAY: '1' },
  })
  try {
    await expect
      .poll(() => textOf(app, '[role=status] h2'), { timeout: 10000 })
      .toBe('No Warp History Yet')
    await app.executeAsync('document.fonts.ready.then(() => arguments[arguments.length - 1]())')
    // The window is 1000 pixels wide inside, so at 125% the page is 800 wide.
    const width = await app.execute<number>('return window.innerWidth')
    expect(Math.abs(width - 800)).toBeLessThanOrEqual(2)
    // Opened with the size overlay, the corner shows the page's size and scale, and
    // follows a resize.
    const overlay = () =>
      app.execute<{ shown?: string; expected: string }>(`
        const scale = Math.round(devicePixelRatio * 100) / 100;
        return {
          shown: document.querySelector('.size-overlay')?.textContent,
          expected: innerWidth + ' × ' + innerHeight + (scale === 1 ? '' : ' · ' + scale + '×'),
        };
      `)
    const matches = async () => {
      const { shown, expected } = await overlay()
      return shown === expected
    }
    await expect.poll(matches, { timeout: 5000 }).toBe(true)
    expect((await overlay()).shown).toMatch(/^\d+ × \d+ · 1\.25×$/)
    await app.screenshot('e2e-mock-zoom')
    await app.command('/window/rect', 'POST', { width: 1280, height: 900 })
    await expect.poll(async () => (await overlay()).shown, { timeout: 5000 }).not.toMatch(/^80\d /)
    expect(await matches()).toBe(true)
    await app.close()
  } finally {
    await app.dispose()
  }
}, 60000)
