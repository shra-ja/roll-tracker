import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import type { Channel } from '@tauri-apps/api/core'
import { localDateTime } from '../src/format'

// Tauri rejects a command with the native failure as plain data, not an Error.
function reject(failure: unknown): never {
  throw failure
}

// Resolve the mocked IPC and the UI's follow-up rendering.
const settle = () => new Promise((resolve) => setTimeout(resolve))

// jsdom has no layout or resize events; the tabs keep their widest form.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
)
// Until a test saves history, the History screen finds none.
const nothingSaved = { account: null, total: 0, categories: [], rolls: [] }

// Mount the whole app afresh, and wait for the router to show the first view.
beforeEach(async () => {
  serve({})
  document.body.innerHTML = '<div id="app"></div>'
  // The address outlives each app, so every test starts from the opening screen.
  history.replaceState(null, '', '/')
  vi.resetModules()
  await import('../src/main')
  await settle()
})
afterEach(clearMocks)

const sidebar = () => document.querySelector<HTMLElement>('nav[aria-label="Main"]')!
// A link's accessible name: its label when it has one, else its text.
const nameOf = (link: Element) => link.getAttribute('aria-label') ?? link.textContent?.trim()
const named = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll<HTMLAnchorElement>('a')].find((link) => nameOf(link) === name)!
// Following a link navigates asynchronously, then the new view renders.
async function follow(link: HTMLAnchorElement) {
  link.click()
  await settle()
}
const openImport = () => follow(named(sidebar(), 'Import'))
const heading = () => document.querySelector('h1')?.textContent
const current = (container: HTMLElement) =>
  [...container.querySelectorAll('a[aria-current]')].map((link) => [
    nameOf(link),
    link.getAttribute('aria-current'),
  ])

// Every icon on screen is a decorative Lucide icon, apart from the brand's emblem.
// Returns the Lucide names shown, so each screen's icons can be checked.
function icons() {
  const drawn = [...document.querySelectorAll('svg')].filter((svg) => !svg.closest('.brand'))
  for (const svg of drawn) {
    expect(svg.classList.contains('lucide')).toBe(true)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
  }
  return drawn.map((svg) =>
    [...svg.classList].find((name) => name.startsWith('lucide-'))!.slice('lucide-'.length),
  )
}

const panel = () => document.querySelector<HTMLElement>('.retrieval')!
// Each step of the flow is its own screen inside the panel, rendered only while shown.
const screen = (name: string) => panel().querySelector<HTMLElement>(`.${name}`)
const shown = (name: string) => screen(name) !== null
// Vue keeps a space either side of a label written on its own line.
const button = (container: Element, name: string) =>
  [...container.querySelectorAll('button')].find((each) => each.textContent?.trim() === name)!
const findButton = () => button(screen('start')!, 'Retrieve history')
const fileInput = () => screen('start')!.querySelector<HTMLInputElement>('#cache-file')!
const note = () => screen('start')!.querySelector('.note')?.textContent?.trim()
const progressStatus = () => screen('progress')!.querySelector('[role="status"]')!.textContent
const steps = () =>
  [...screen('progress')!.querySelectorAll<HTMLElement>('.steps > li')].map((step) => [
    step.querySelector('.label')!.textContent?.trim(),
    step.dataset.state,
  ])
const cancelButton = () => screen('progress')!.querySelector<HTMLButtonElement>('.cancel')!
const reviewPanel = () => screen('review')!
const reviewHeading = () => reviewPanel().querySelector('h2')!
const reviewButton = (name: string) => button(reviewPanel(), name)
const rows = () =>
  [...reviewPanel().querySelectorAll('tbody tr')].map((row) =>
    [...row.children].map((cell) => cell.textContent?.trim()),
  )
const failedHeading = () => screen('failed')!.querySelector('h2')!
// Vue updates the page on the next tick, so each helper waits for it.
function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
  return nextTick()
}
function click(element: HTMLElement) {
  element.click()
  return nextTick()
}

type Handler = (args: Record<string, unknown>) => unknown
// Route each mocked command to its handler, recording the commands called. The
// History screen finds nothing saved unless a test serves its own history.
function serve(handlers: Record<string, Handler>) {
  const calls: string[] = []
  const served: Record<string, Handler> = {
    history_page: () => nothingSaved,
    last_import: () => null,
    saved_accounts: () => [],
    ...handlers,
  }
  mockIPC((cmd, args) => {
    calls.push(cmd)
    return served[cmd]?.(args as Record<string, unknown>)
  })
  return calls
}
// The commands a flow made, leaving out the Import screen's local read of the last import.
const flow = (calls: string[]) => calls.filter((call) => call !== 'last_import')
type Progress = Channel<unknown>
const progressOf = (args: Record<string, unknown>) => args.onProgress as Progress
type Conflict = { id: string; gacha_type: string; time: string }
// A synthetic review with every count in Stellar Warp.
const review = (inserted: number, duplicates = 0, conflicts: Conflict[] = []) => ({
  kind: 'review',
  uid: '100000001',
  server: 'synthetic-server',
  timezone: 8,
  summary: { inserted, duplicates, conflicts: conflicts.length },
  new_five_star: inserted === 0 ? 0 : 1,
  new_four_star: inserted === 0 ? 0 : 2,
  categories: ['1', '2', '11', '12', '21', '22'].map((gacha_type, index) =>
    index === 0
      ? { gacha_type, inserted, duplicates, conflicts: conflicts.length }
      : { gacha_type, inserted: 0, duplicates: 0, conflicts: 0 },
  ),
  earliest: '2026-04-02 10:00:00',
  latest: '2026-09-28 21:30:00',
  conflicts,
})
// A command that stays pending until the test resolves or rejects it.
function pending() {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { handler: () => promise, resolve, reject }
}

test('a development window opened with the size overlay shows its size; others never do', async () => {
  expect(document.querySelector('.size-overlay')).toBeNull()
  const scope = window as { __ASTRAL_INDEX_SIZE_OVERLAY__?: boolean }
  scope.__ASTRAL_INDEX_SIZE_OVERLAY__ = true
  try {
    document.body.innerHTML = '<div id="app"></div>'
    vi.resetModules()
    await import('../src/main')
    await settle()
    expect(document.querySelector('.size-overlay')?.textContent).toBe(
      `${window.innerWidth} × ${window.innerHeight}`,
    )
  } finally {
    delete scope.__ASTRAL_INDEX_SIZE_OVERLAY__
  }
})

test('opens on Star Rail’s warp history, with the games and screens in a sidebar', () => {
  expect(location.hash).toBe('#/honkai-star-rail/history')
  expect(heading()).toBe('Warp History')
  expect(document.querySelector('header')?.textContent).toContain('Honkai: Star Rail')
  expect(current(sidebar())).toEqual([
    ['Honkai: Star Rail', 'true'],
    ['Warp History', 'page'],
  ])
  expect(named(sidebar(), 'Genshin Impact').getAttribute('href')).toBe('#/genshin-impact/history')
  expect(named(sidebar(), 'Import').getAttribute('href')).toBe('#/honkai-star-rail/import')
  expect(sidebar().textContent).toContain('Stored on this device')
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No Warp History Yet')
  expect(document.querySelector('.retrieval')).toBeNull()
  expect(document.body.textContent).not.toMatch(/pity|guarantee|win rate/i)
  expect(icons()).toEqual(['text-align-start', 'download', 'lock', 'text-align-start', 'download'])
})

test('switching games keeps the screen, and each game names its own history', async () => {
  await follow(named(sidebar(), 'Genshin Impact'))
  expect(location.hash).toBe('#/genshin-impact/history')
  expect(heading()).toBe('Wish History')
  expect(current(sidebar())).toEqual([
    ['Genshin Impact', 'true'],
    ['Wish History', 'page'],
  ])
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No Wish History Yet')
  await openImport()
  expect(location.hash).toBe('#/genshin-impact/import')
  expect(heading()).toBe('Import')
  expect(screen('start')!.querySelector('h2')?.textContent).toBe('Add Wish History')
  expect(screen('start')!.textContent).toContain('Retrieval for Genshin Impact is coming soon.')
  expect(findButton().disabled).toBe(true)
  expect(fileInput().disabled).toBe(true)
  await follow(named(sidebar(), 'Honkai: Star Rail'))
  expect(location.hash).toBe('#/honkai-star-rail/import')
  expect(findButton().disabled).toBe(false)
  expect(screen('start')!.textContent).not.toContain('coming soon')
})

test('the empty history leads to the Import screen', async () => {
  await follow(named(document.querySelector('main')!, 'Go to Import'))
  expect(location.hash).toBe('#/honkai-star-rail/import')
  expect(heading()).toBe('Import')
})

test('a retrieval keeps running while another screen is shown', async () => {
  await openImport()
  const retrieval = pending()
  serve({ retrieve_history: retrieval.handler })
  findButton().click()
  await settle()
  await follow(named(sidebar(), 'Warp History'))
  retrieval.resolve(review(3))
  await settle()
  await openImport()
  expect(reviewHeading().textContent).toBe('Ready to save 3 new rolls')
})

// Synthetic saved history: 45 Character Event and 3 Stellar Warp rolls.
const savedCounts: Record<string, number> = { '1': 3, '11': 45 }
function savedHistory(args: Record<string, unknown>) {
  const { category, page, pageSize, filter } = args as {
    category: string
    page: number
    pageSize: number
    filter?: { rarities?: string[]; search?: string; from?: string; to?: string }
  }
  const { rarities, search, from } = filter ?? {}
  // Roll 45 is on 28 Sep and the rest earlier, so a range from 28 Sep keeps it alone.
  const nameOf = (number: number) => (number === 45 ? 'Synthetic Hero' : 'Arrows')
  const total = savedCounts[category] ?? 0
  // Newest first, numbered in the whole category, then the rarities shown.
  const matching = Array.from({ length: total }, (_, index) => total - index).filter(
    (number) =>
      (rarities ?? ['5', '4', '3']).includes(number === 45 ? '5' : '3') &&
      (!from || number === 45 || from <= '2026-09-27') &&
      nameOf(number)
        .toLowerCase()
        .includes((search ?? '').trim().toLowerCase()),
  )
  return {
    account: { uid: '100000001', server: 'prod_official_asia', timezone: 8 },
    total,
    matched: matching.length,
    soft_pity: { near: 49, soft: 74 },
    categories: ['1', '2', '11', '12', '21', '22'].map((gacha_type) => ({
      gacha_type,
      total: savedCounts[gacha_type] ?? 0,
    })),
    // Roll 45 of Character Event Warp is the only 5★.
    summary: {
      five_star: category === '11' && total > 0 ? 1 : 0,
      four_star: 0,
      first: total > 0 ? '2026-04-26 10:00:00' : null,
      last: total > 0 ? '2026-09-28 21:14:03' : null,
    },
    // No 5★ comes before roll 45, so each roll's pity is its number.
    rolls: matching.slice((page - 1) * pageSize, page * pageSize).map((number) => ({
      number,
      pity: number,
      id: `${category}-${number}`,
      name: nameOf(number),
      item_type: number === 45 ? 'Character' : 'Light Cone',
      rank_type: number === 45 ? '5' : '3',
      time: '2026-09-28 21:14:03',
    })),
  }
}
// Serve the given history, then open the History screen afresh so it reads it.
async function openHistory(handler: Handler, handlers: Record<string, Handler> = {}) {
  const reads: unknown[] = []
  const calls = serve({
    history_page: (args) => {
      reads.push(args)
      return handler(args)
    },
    ...handlers,
  })
  await openImport()
  await follow(named(sidebar(), 'Warp History'))
  return { calls, reads }
}
const main = () => document.querySelector('main')!
const tabs = () =>
  [...main().querySelectorAll('[aria-label="Banner category"] button')].map((tab) => [
    tab.textContent?.replace(/\s+/g, ' ').trim(),
    tab.getAttribute('aria-pressed'),
  ])
const listed = () =>
  [...main().querySelectorAll('.roll-list .body [role="row"]')].map(
    (row) => row.querySelector('[role="cell"]')?.textContent,
  )
// The summary strip's tiles, as "label: value rate".
const strip = () =>
  [...main().querySelectorAll('[aria-label="Category summary"] .tile')].map(
    (tile) =>
      `${tile.querySelector('.label')?.textContent}: ` +
      [...tile.querySelectorAll('.value, .rate')]
        .map((part) => part.textContent?.replace(/\s+/g, ' ').trim())
        .join(' '),
  )
const showing = () => main().querySelector('.showing')?.textContent?.replace(/\s+/g, ' ').trim()
const pageButton = (name: string) =>
  main().querySelector<HTMLButtonElement>(`nav[aria-label="Pages"] [aria-label="${name}"]`)!

test('saved history shows its account, category counts and newest rolls first', async () => {
  const { calls, reads } = await openHistory(savedHistory)
  expect(main().querySelector('.account')?.getAttribute('aria-label')).toBe(
    'Account: UID 100000001, Asia server',
  )
  expect(tabs()).toEqual([
    ['Character Event 45', 'true'],
    ['Light Cone Event 0', 'false'],
    ['Stellar 3', 'false'],
    ['Departure 0', 'false'],
    ['Character Collab 0', 'false'],
    ['Light Cone Collab 0', 'false'],
  ])
  expect(main().querySelector('[role="table"]')?.getAttribute('aria-label')).toBe(
    'Character Event Warp rolls, newest first',
  )
  expect(main().querySelector('[aria-sort]')?.textContent).toBe('Time (UTC+8)')
  // The strip summarises the whole category, not just the page shown.
  expect(strip()).toEqual([
    'Rolls stored: 45',
    '5★ rolls: 1 2.22%',
    '4★ rolls: 0 0.00%',
    'Stored period: 26 Apr 2026 – 28 Sep 2026',
  ])
  expect(listed()).toHaveLength(20)
  expect(listed()[0]).toBe('45')
  expect(main().querySelector('.rarity-5 .name')?.textContent).toBe('Synthetic Hero')
  expect(showing()).toBe('Showing 1–20 of 45')
  // Reading saved history only reads this device; it never asks HoYoverse for anything.
  expect(new Set(calls)).toEqual(new Set(['history_page', 'last_import', 'saved_accounts']))
  expect(reads).toEqual([{ category: '11', page: 1, pageSize: 20 }])
  expect(icons().slice(3)).toEqual([
    'search',
    'calendar-days',
    'list',
    'layout-grid',
    'grid-3x3',
    'chevron-left',
    'chevron-right',
    'chevron-down',
  ])
  // Pity shows for every roll, the 5★ at the pity it came at; guarantees and win
  // rates need banner metadata, so nothing claims them.
  expect(
    [...main().querySelectorAll('.roll-list .body [role="row"]')]
      .slice(0, 2)
      .map((row) => row.querySelector('.pity')?.textContent),
  ).toEqual(['45', '44'])
  // The 5★'s pity is coloured by the category's soft pity; the others stay plain.
  expect(main().querySelector('.rarity-5 .pity')?.classList.contains('band-early')).toBe(true)
  expect(document.body.textContent).not.toMatch(/guarantee|win rate|50\/50/i)
})

// A second saved account, on the Europe server, with 2 Stellar Warp rolls only.
const accounts = [
  { uid: '100000001', server: 'prod_official_asia', timezone: 8, rolls: 48 },
  { uid: '100000002', server: 'prod_official_eur', timezone: 1, rolls: 2 },
]
function historyOf(args: Record<string, unknown>) {
  const account = args.account as { uid: string; server: string } | undefined
  if (account?.uid !== '100000002') return savedHistory(args)
  const total = args.category === '1' ? 2 : 0
  return {
    account: { uid: '100000002', server: 'prod_official_eur', timezone: 1 },
    total,
    matched: total,
    soft_pity: null,
    categories: ['1', '2', '11', '12', '21', '22'].map((gacha_type) => ({
      gacha_type,
      total: gacha_type === '1' ? 2 : 0,
    })),
    summary: {
      five_star: 0,
      four_star: 0,
      first: total > 0 ? '2026-09-20 10:00:00' : null,
      last: total > 0 ? '2026-09-20 10:00:00' : null,
    },
    rolls: Array.from({ length: total }, (_, index) => ({
      number: total - index,
      pity: total - index,
      id: `eur-${total - index}`,
      name: 'Arrows',
      item_type: 'Light Cone',
      rank_type: '3',
      time: '2026-09-20 10:00:00',
    })),
  }
}
const switcher = () => main().querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')

test('with one saved account the header names it; with more it switches between them', async () => {
  await openHistory(savedHistory, { saved_accounts: () => accounts.slice(0, 1) })
  expect(switcher()).toBeNull()
  expect(main().querySelector('.account')).not.toBeNull()
  const { reads } = await openHistory(historyOf, { saved_accounts: () => accounts })
  expect(main().querySelector('.account')).toBeNull()
  expect(switcher()?.getAttribute('aria-label')).toBe(
    'Switch account. Current: UID 100000001, Asia server',
  )
  await click(switcher()!)
  const items = [...main().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
  expect(items.map((item) => item.querySelector('.rolls')?.textContent)).toEqual([
    '48 rolls',
    '2 rolls',
  ])
  items[1].click()
  await settle()
  // Its history opens on its first category with rolls, in its own server time.
  expect(reads.slice(-2)).toEqual([
    {
      category: '11',
      page: 1,
      pageSize: 20,
      account: { uid: '100000002', server: 'prod_official_eur' },
    },
    {
      category: '1',
      page: 1,
      pageSize: 20,
      account: { uid: '100000002', server: 'prod_official_eur' },
    },
  ])
  expect(switcher()?.getAttribute('aria-label')).toBe(
    'Switch account. Current: UID 100000002, Europe server',
  )
  expect(tabs()[2]).toEqual(['Stellar 2', 'true'])
  // The strip follows the account, and a one-day period still reads as a range.
  expect(strip()[0]).toBe('Rolls stored: 2')
  expect(strip()[3]).toBe('Stored period: 20 Sep 2026 – 20 Sep 2026')
  expect(main().querySelector('[aria-sort]')?.textContent).toBe('Time (UTC+1)')
  expect(document.activeElement).toBe(switcher())
  // Leaving the screen and coming back keeps the chosen account.
  await openImport()
  await follow(named(sidebar(), 'Warp History'))
  expect(switcher()?.getAttribute('aria-label')).toContain('UID 100000002')
})

test('history pages through a category, resizes pages and switches categories', async () => {
  const { reads } = await openHistory(savedHistory)
  pageButton('Next page').click()
  await settle()
  expect([listed()[0], showing()]).toEqual(['25', 'Showing 21–40 of 45'])
  pageButton('Page 3').click()
  await settle()
  expect([listed(), showing()]).toEqual([['5', '4', '3', '2', '1'], 'Showing 41–45 of 45'])
  const size = main().querySelector<HTMLSelectElement>('.size select')!
  size.value = '50'
  size.dispatchEvent(new Event('change'))
  await settle()
  expect([listed().length, showing()]).toEqual([45, 'Showing 1–45 of 45'])
  button(main(), 'Stellar 3').click()
  await settle()
  expect(tabs()[2]).toEqual(['Stellar 3', 'true'])
  expect([listed(), showing()]).toEqual([['3', '2', '1'], 'Showing 1–3 of 3'])
  expect(reads.slice(1)).toEqual([
    { category: '11', page: 2, pageSize: 20 },
    { category: '11', page: 3, pageSize: 20 },
    { category: '11', page: 1, pageSize: 50 },
    { category: '1', page: 1, pageSize: 50 },
  ])
  // A category without rolls says so, with no pages.
  button(main(), 'Departure 0').click()
  await settle()
  expect(main().querySelector('.none')?.textContent?.trim()).toBe(
    'No Departure Warp rolls saved yet.',
  )
  expect(main().querySelector('[role="table"]')).toBeNull()
  expect(main().querySelector('nav[aria-label="Pages"]')).toBeNull()
})

const filter = (name: string) =>
  main().querySelector<HTMLButtonElement>(`[aria-label="Show rarities"] .rarity-${name}`)!

test('the layout switch shows rolls as tiles, keeping the layout until the screen closes', async () => {
  await openHistory(savedHistory)
  const layout = (name: string) =>
    main().querySelector<HTMLButtonElement>(`[aria-label="Layout"] [aria-label="${name} view"]`)!
  const tiles = () =>
    [...main().querySelectorAll('.roll-grid li')].map(
      (tile) => tile.querySelector('.detail')?.textContent,
    )
  expect(layout('List').getAttribute('aria-pressed')).toBe('true')
  expect(tiles()).toEqual([])
  await click(layout('Grid'))
  expect(layout('Grid').getAttribute('aria-pressed')).toBe('true')
  expect(main().querySelector('[role="table"]')).toBeNull()
  expect(main().querySelector('.roll-grid')?.getAttribute('aria-label')).toBe(
    'Character Event Warp rolls, newest first',
  )
  expect(tiles()).toHaveLength(20)
  expect(tiles()[0]).toBe('Character · #45')
  expect(showing()).toBe('Showing 1–20 of 45')
  // Another category keeps the grid.
  button(main(), 'Stellar 3').click()
  await settle()
  expect(tiles()).toHaveLength(3)
  // Icons name each roll for assistive technology, the newest first.
  await click(layout('Icons'))
  expect(main().querySelector('.roll-grid')).toBeNull()
  const icons = [...main().querySelectorAll('.roll-icons [role="img"]')]
  expect(icons).toHaveLength(3)
  expect(icons[0].getAttribute('aria-label')).toMatch(/^.+, [345]★, pity \d+, #3, \d+ \w{3} \d{4}$/)
  // Leaving the screen and coming back starts from the list again.
  await openImport()
  await follow(named(sidebar(), 'Warp History'))
  expect(layout('List').getAttribute('aria-pressed')).toBe('true')
  expect(listed()).toHaveLength(20)
})

test('rarity filters hide rolls across the whole category, keeping their numbers', async () => {
  const { reads } = await openHistory(savedHistory)
  expect(
    [...main().querySelectorAll('[aria-label="Show rarities"] button')].map((button) =>
      button.getAttribute('aria-pressed'),
    ),
  ).toEqual(['true', 'true', 'true'])
  filter('3').click()
  await settle()
  expect(filter('3').getAttribute('aria-pressed')).toBe('false')
  expect(reads.at(-1)).toEqual({
    category: '11',
    page: 1,
    pageSize: 20,
    filter: { rarities: ['5', '4'] },
  })
  // Only the 5★ is left, still numbered 45; the tabs and strip still count everything.
  expect(listed()).toEqual(['45'])
  expect(showing()).toBe('Showing 1–1 of 1')
  expect(tabs()[0]).toEqual(['Character Event 45', 'true'])
  expect(strip()[0]).toBe('Rolls stored: 45')
  // With nothing shown, the panel says why and the pages go.
  filter('5').click()
  await settle()
  expect(main().querySelector('.none')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
    'No rolls match these filters. Try another search or turn on more rarities.',
  )
  expect(main().querySelector('nav[aria-label="Pages"]')).toBeNull()
  // The filters stay when the category changes.
  button(main(), 'Stellar 3').click()
  await settle()
  expect(reads.at(-1)).toEqual({
    category: '1',
    page: 1,
    pageSize: 20,
    filter: { rarities: ['4'] },
  })
})

test('searching item names narrows the list once typing pauses, keeping roll numbers', async () => {
  const { reads } = await openHistory(savedHistory)
  const box = main().querySelector<HTMLInputElement>('input[type="search"]')!
  expect(main().querySelector(`label[for="${box.id}"]`)?.textContent).toBe('Search items')
  box.value = 'synthetic h'
  box.dispatchEvent(new Event('input'))
  await settle()
  // Nothing is read until typing pauses.
  expect(reads).toHaveLength(1)
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(reads.at(-1)).toEqual({
    category: '11',
    page: 1,
    pageSize: 20,
    filter: { search: 'synthetic h' },
  })
  expect(listed()).toEqual(['45'])
  expect(showing()).toBe('Showing 1–1 of 1')
  expect(strip()[0]).toBe('Rolls stored: 45')
  box.value = 'kafka'
  box.dispatchEvent(new Event('input'))
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(main().querySelector('.none')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
    'No rolls match these filters. Try another search or turn on more rarities.',
  )
})

test('choosing days in the date popover reads only rolls on and after them', async () => {
  const { reads } = await openHistory(savedHistory)
  const dates = main().querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
  expect(dates.textContent?.trim()).toBe('All dates')
  await click(dates)
  const dialog = main().querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.querySelector('.note')?.textContent).toBe(
    'Server time (UTC+8). Saved rolls span 26 Apr 2026 – 28 Sep 2026.',
  )
  const from = [...dialog.querySelectorAll('label')]
    .find((label) => label.textContent?.trim() === 'From')!
    .querySelector('input')!
  from.value = '2026-09-28'
  from.dispatchEvent(new Event('change'))
  await settle()
  expect(reads.at(-1)).toEqual({
    category: '11',
    page: 1,
    pageSize: 20,
    filter: { from: '2026-09-28' },
  })
  expect(listed()).toEqual(['45'])
  expect(dates.textContent?.trim()).toBe('From 28 Sep 2026')
  // The tabs and strip still count everything; Clear shows every date again.
  expect(strip()[0]).toBe('Rolls stored: 45')
  await click(dialog.querySelector<HTMLButtonElement>('button.clear')!)
  await settle()
  expect(reads.at(-1)).toEqual({ category: '11', page: 1, pageSize: 20 })
  expect(showing()).toBe('Showing 1–20 of 45')
})

test('history that cannot be read says so, and Try again reads it again', async () => {
  let fail = true
  const { reads } = await openHistory((args) =>
    fail ? reject({ kind: 'storage' }) : savedHistory(args),
  )
  const alert = main().querySelector('[role="alert"]')!
  expect(alert.querySelector('h2')?.textContent).toBe('Couldn’t Show Your Warp History')
  expect(icons().slice(3)).toEqual(['triangle-alert'])
  expect(alert.textContent).toContain('We couldn’t read the history saved on this device.')
  expect(main().querySelector('[role="table"]')).toBeNull()
  fail = false
  button(alert, 'Try again').click()
  await settle()
  expect(main().querySelector('[role="alert"]')).toBeNull()
  expect(listed()[0]).toBe('45')
  expect(reads).toHaveLength(2)
})

test('Genshin Impact’s history reads nothing until it has an adapter', async () => {
  const calls = serve({})
  await follow(named(sidebar(), 'Genshin Impact'))
  expect(calls).toEqual([])
  expect(main().querySelector('[role="status"]')?.textContent).toContain('No Wish History Yet')
  // Returning to Star Rail reads its saved accounts and history again.
  await follow(named(sidebar(), 'Honkai: Star Rail'))
  expect(calls).toEqual(['saved_accounts', 'history_page'])
})

test('an unknown address returns to Star Rail’s history', async () => {
  const { default: router } = await import('../src/router')
  await router.push('/somewhere/else')
  await settle()
  expect(location.hash).toBe('#/honkai-star-rail/history')
})

test('Star Rail offers retrieval from HoYoverse or a chosen cache file; file import is coming soon', async () => {
  await openImport()
  const start = screen('start')!
  expect(start.querySelector('h2')?.textContent).toBe('Add Warp History')
  expect(icons().slice(3)).toEqual(['cloud-download', 'file-text'])
  expect(start.textContent).toContain('downloads your roll history from HoYoverse')
  expect(findButton().type).toBe('button')
  expect(
    start.querySelector<HTMLLabelElement>('label[for="cache-file"]')?.textContent?.trim(),
  ).toBe('Choose cache file…')
  expect(fileInput().type).toBe('file')
  const fileImport = button(start, 'Choose file…')
  expect(fileImport.getAttribute('aria-disabled')).toBe('true')
  expect(document.getElementById(fileImport.getAttribute('aria-describedby')!)?.textContent).toBe(
    'Importing from a file isn’t available yet.',
  )
  expect(note()).toBeUndefined()
  expect(shown('progress')).toBe(false)
  expect(start.textContent).not.toContain('Nothing is sent anywhere')
})

test('starting retrieval shows progress, then the review, then what was saved', async () => {
  const extraction = pending()
  const retrieval = pending()
  let progress!: Progress
  const calls = serve({
    extract_automatically: extraction.handler,
    retrieve_history: (args) => {
      progress = progressOf(args)
      return retrieval.handler()
    },
  })
  await openImport()
  findButton().focus()
  await click(findButton())
  expect(shown('start')).toBe(false)
  expect(screen('progress')!.querySelector('h2')?.textContent).toBe('Retrieving Warp History')
  expect(document.activeElement).toBe(cancelButton())
  expect(panel().getAttribute('aria-busy')).toBe('true')
  expect(progressStatus()).toBe('Searching this device, then checking with HoYoverse…')
  expect(steps()).toEqual([
    ['Find the warp history link in the game files', 'active'],
    ['Check the link with HoYoverse', 'active'],
    ['Download your rolls', 'waiting'],
    ['Prepare the review', 'waiting'],
  ])
  extraction.resolve(undefined)
  await settle()
  expect(progressStatus()).toBe('Retrieving your warp history…')
  expect(steps()).toEqual([
    ['Found the warp history link in the game files', 'done'],
    ['Checked the link with HoYoverse', 'done'],
    ['Downloading your rolls', 'active'],
    ['Prepare the review', 'waiting'],
  ])
  // Stellar and Departure Warp come first, as retrieval requests them.
  progress.onmessage({ kind: 'requesting', gacha_type: '1', page: 1, pages: 0, records: 0 })
  progress.onmessage({ kind: 'requesting', gacha_type: '2', page: 1, pages: 1, records: 20 })
  progress.onmessage({ kind: 'requesting', gacha_type: '11', page: 1, pages: 2, records: 30 })
  progress.onmessage({ kind: 'requesting', gacha_type: '11', page: 2, pages: 3, records: 1532 })
  await nextTick()
  expect(progressStatus()).toBe('Retrieving Character Event Warp, page 2 · 1,532 rolls so far')
  expect(
    [...screen('progress')!.querySelectorAll('.categories .pages')].map(
      (pages) => pages.textContent,
    ),
  ).toEqual(['1 page', '1 page', 'page 2', '—', '—', '—'])
  // The row, bar and category list show progress; the status is only announced.
  const progressPanel = screen('progress')!
  expect(progressPanel.querySelector('.summary')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
    'Category 3 of 6 1,532 rolls so far',
  )
  expect(progressPanel.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
    '2',
  )
  expect(
    [...progressPanel.querySelectorAll('.categories li')].map((row) =>
      row.getAttribute('data-state'),
    ),
  ).toEqual(['done', 'done', 'active', 'waiting', 'waiting', 'waiting'])
  expect(
    progressPanel.querySelector('[role="status"]')?.classList.contains('visually-hidden'),
  ).toBe(true)
  progress.onmessage({ kind: 'retry_pending', delay_ms: 1000 })
  await nextTick()
  expect(progressStatus()).toBe('HoYoverse didn’t respond, so we’ll try again in a moment…')
  // A retry wait is shown as well as announced.
  expect(
    screen('progress')!.querySelector('[role="status"]')?.classList.contains('visually-hidden'),
  ).toBe(false)
  retrieval.resolve(review(412, 88))
  await settle()
  expect(flow(calls)).toEqual(['extract_automatically', 'retrieve_history'])
  expect(shown('progress')).toBe(false)
  expect(heading()).toBe('Review Import')
  expect(panel().getAttribute('aria-busy')).toBe('false')
  expect(reviewHeading().textContent).toBe('Ready to save 412 new rolls')
  expect(document.activeElement).toBe(reviewHeading())
  expect(reviewPanel().textContent).toContain('UID 100000001')
  expect(reviewPanel().textContent).toContain('synthetic-server')
  expect(
    [...reviewPanel().querySelectorAll('.stat')].map((stat) => [
      stat.querySelector('.stat-label')?.textContent,
      stat.querySelector('.stat-value')?.textContent?.trim(),
    ]),
  ).toEqual([
    ['New rolls', '412'],
    ['Existing rolls skipped', '88'],
    ['Conflicts', '0'],
    ['Retrieved period', '2 Apr 2026 – 28 Sep 2026'],
  ])
  expect([...reviewPanel().querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
    'Category',
    'New',
    'Skipped',
  ])
  expect(rows()).toEqual([
    ['Stellar Warp', '412', '88'],
    ['Departure Warp', '0', '0'],
    ['Character Event Warp', '0', '0'],
    ['Light Cone Event Warp', '0', '0'],
    ['Character Collaboration Warp', '0', '0'],
    ['Light Cone Collaboration Warp', '0', '0'],
  ])
  expect(reviewPanel().querySelector('.conflicts')).toBeNull()
  const commit = pending()
  serve({ commit_import: commit.handler })
  await click(reviewButton('Save 412 rolls'))
  await settle()
  expect(reviewButton('Save 412 rolls').disabled).toBe(true)
  expect(reviewButton('Discard').disabled).toBe(true)
  expect(panel().getAttribute('aria-busy')).toBe('true')
  commit.resolve({ inserted: 412, duplicates: 88, conflicts: 0 })
  await settle()
  expect(shown('review')).toBe(false)
  expect(heading()).toBe('Import')
  const saved = screen('saved')!
  expect(saved.querySelector('h2')?.textContent).toBe('412 Rolls Saved')
  expect(icons().slice(3)).toEqual(['check'])
  expect(document.activeElement).toBe(saved.querySelector('h2'))
  expect(saved.querySelector('p')?.textContent).toBe('Added to UID 100000001 (synthetic-server).')
  expect(
    [...saved.querySelectorAll('.stat')].map((stat) => [
      stat.querySelector('.stat-value')?.textContent,
      stat.querySelector('.stat-label')?.textContent,
    ]),
  ).toEqual([
    ['1', 'New 5★'],
    ['2', 'New 4★'],
    ['88', 'Existing rolls skipped'],
  ])
  await click(button(saved, 'Done'))
  await nextTick()
  expect(shown('saved')).toBe(false)
  expect(document.activeElement).toBe(findButton())
  // A later review starts with its buttons enabled again.
  serve({ retrieve_history: () => review(1) })
  findButton().click()
  await settle()
  expect(reviewButton('Save 1 roll').disabled).toBe(false)
  expect(reviewButton('Discard').disabled).toBe(false)
})

test('after saving, the history is one link away', async () => {
  serve({
    retrieve_history: () => review(2),
    commit_import: () => ({ inserted: 2, duplicates: 0, conflicts: 0 }),
  })
  await openImport()
  findButton().click()
  await settle()
  reviewButton('Save 2 rolls').click()
  await settle()
  await follow(named(screen('saved')!, 'View warp history'))
  expect(location.hash).toBe('#/honkai-star-rail/history')
  await openImport()
  expect(shown('start')).toBe(true)
})

test('discarding the review saves nothing and says so', async () => {
  const calls = serve({ retrieve_history: () => review(4) })
  await openImport()
  findButton().click()
  await settle()
  reviewButton('Discard').click()
  await settle()
  expect(flow(calls)).toEqual(['extract_automatically', 'retrieve_history', 'discard_import'])
  expect(shown('review')).toBe(false)
  expect(note()).toBe('Discarded the retrieved history. Nothing was saved.')
  expect(document.activeElement).toBe(findButton())
})

test('when everything is already saved, Done replaces Save and Discard', async () => {
  const calls = serve({ retrieve_history: () => review(0, 5) })
  await openImport()
  findButton().click()
  await settle()
  expect(reviewHeading().textContent).toBe('Everything here is already saved')
  expect(reviewButton('Save 0 rolls')).toBeUndefined()
  expect(reviewButton('Discard')).toBeUndefined()
  reviewButton('Done').click()
  await settle()
  expect(flow(calls)).toEqual(['extract_automatically', 'retrieve_history', 'discard_import'])
  expect(note()).toBe('Your saved history is already up to date.')
})

test('conflicting rolls are listed and cannot be saved', async () => {
  serve({
    retrieve_history: () =>
      review(2, 0, [
        { id: '1000000000000000001', gacha_type: '11', time: '2026-05-01 12:00:00' },
        { id: '1000000000000000002', gacha_type: '1', time: '2026-05-02 13:00:00' },
      ]),
  })
  await openImport()
  findButton().click()
  await settle()
  expect(reviewHeading().textContent).toBe('Some rolls conflict with your saved history')
  const conflicts = reviewPanel().querySelector<HTMLElement>('.conflicts')!
  expect(conflicts.textContent).toContain(
    'differ from saved rolls with the same ID, so nothing can be saved',
  )
  expect([...conflicts.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
    'Character Event Warp · 2026-05-01 12:00:00 · ID 1000000000000000001',
    'Stellar Warp · 2026-05-02 13:00:00 · ID 1000000000000000002',
  ])
  const save = reviewButton('Save 2 rolls')
  expect(save.disabled).toBe(true)
  expect(save.getAttribute('aria-describedby')).toBe(conflicts.querySelector('p')!.id)
  // The next review lists only its own conflicts, and Save describes nothing.
  reviewButton('Discard').click()
  await settle()
  serve({ retrieve_history: () => review(2) })
  findButton().click()
  await settle()
  expect(reviewPanel().querySelector('.conflicts')).toBeNull()
  expect(reviewButton('Save 2 rolls').hasAttribute('aria-describedby')).toBe(false)
})

test('a failed save explains what happened, then goes back to the start', async () => {
  serve({
    retrieve_history: () => review(2),
    commit_import: () => reject({ kind: 'conflict' }),
  })
  await openImport()
  findButton().click()
  await settle()
  reviewButton('Save 2 rolls').click()
  await settle()
  expect(shown('review')).toBe(false)
  expect(failedHeading().textContent).toBe('Nothing Was Saved')
  expect(document.activeElement).toBe(failedHeading())
  expect(screen('failed')!.textContent).toContain(
    'Some retrieved rolls differ from ones already saved. Nothing was saved.',
  )
  await click(button(screen('failed')!, 'Back'))
  await nextTick()
  expect(shown('failed')).toBe(false)
  expect(document.activeElement).toBe(findButton())
})

const lastLine = () =>
  [...(screen('start')?.querySelectorAll('.last-import .part') ?? [])].map(
    (part) => part.textContent,
  )

test('Star Rail’s Import screen shows the last import, read again after each save', async () => {
  let last: unknown = null
  const calls = serve({
    last_import: () => last,
    retrieve_history: () => review(5),
    commit_import: () => ({ inserted: 5, duplicates: 0, conflicts: 0 }),
  })
  await openImport()
  // Nothing has been imported yet, so there is no line.
  expect(screen('start')!.querySelector('.last-import')).toBeNull()
  findButton().click()
  await settle()
  last = {
    imported_at: 1790000000,
    source: 'hoyoverse',
    uid: '100000001',
    server: 'prod_official_asia',
    inserted: 5,
  }
  await click(reviewButton('Save 5 rolls'))
  await settle()
  await click(button(screen('saved')!, 'Done'))
  await settle()
  expect(lastLine()).toEqual([
    localDateTime(1790000000),
    'Retrieved from HoYoverse',
    'UID 100000001 (Asia)',
    '5 new rolls saved',
  ])
  expect(calls.filter((call) => call === 'last_import')).toHaveLength(2)
  // Genshin Impact has no imports of its own yet.
  await follow(named(sidebar(), 'Genshin Impact'))
  expect(screen('start')!.querySelector('.last-import')).toBeNull()
  // A failed read leaves the line out.
  serve({ last_import: () => reject({ kind: 'storage' }) })
  await follow(named(sidebar(), 'Honkai: Star Rail'))
  expect(screen('start')!.querySelector('.last-import')).toBeNull()
})

test('retrieval asks for new rolls only by default, or the full history when chosen', async () => {
  const modes: unknown[] = []
  serve({
    retrieve_history: (args) => {
      modes.push(args.mode)
      return { kind: 'no_history' }
    },
  })
  await openImport()
  const radio = (name: string) =>
    [...screen('start')!.querySelectorAll<HTMLInputElement>('fieldset input')].find(
      (input) => input.labels?.[0]?.textContent?.trim() === name,
    )!
  expect(radio('New rolls only').checked).toBe(true)
  findButton().click()
  await settle()
  radio('Full history').click()
  await nextTick()
  findButton().click()
  await settle()
  expect(modes).toEqual(['new', 'full'])
  // The choice stays while the app is open.
  await follow(named(sidebar(), 'Warp History'))
  await openImport()
  expect(radio('Full history').checked).toBe(true)
})

test('a failed retrieval says where it stopped, and Try again starts over', async () => {
  const calls = serve({
    retrieve_history: () => reject({ kind: 'network', gacha_type: '12', page: 2 }),
  })
  await openImport()
  findButton().click()
  await settle()
  expect(failedHeading().textContent).toBe('Couldn’t Reach HoYoverse')
  expect(icons().slice(3)).toEqual(['triangle-alert'])
  expect(screen('failed')!.textContent).toContain(
    'Retrieval stopped at Light Cone Event Warp, page 2. We couldn’t reach HoYoverse. Check your internet connection, then try again.',
  )
  expect(flow(calls)).toEqual(['extract_automatically', 'retrieve_history'])
  serve({ retrieve_history: () => review(1) })
  button(screen('failed')!, 'Try again').click()
  await settle()
  expect(reviewHeading().textContent).toBe('Ready to save 1 new roll')
})

test('cancelling during validation stops before retrieval and says so', async () => {
  const extraction = pending()
  const calls = serve({ extract_automatically: extraction.handler })
  await openImport()
  await click(findButton())
  await click(cancelButton())
  expect(cancelButton().disabled).toBe(true)
  expect(progressStatus()).toBe('Cancelling…')
  await settle()
  extraction.reject({ kind: 'cancelled' })
  await settle()
  expect(flow(calls)).toEqual(['extract_automatically', 'cancel_acquisition'])
  expect(shown('progress')).toBe(false)
  expect(note()).toBe('Retrieval cancelled. Nothing was saved.')
  expect(document.activeElement).toBe(findButton())
})

test('if cancelling cannot be sent, retrieval carries on and can be cancelled again', async () => {
  const retrieval = pending()
  let progress!: Progress
  serve({
    retrieve_history: (args) => {
      progress = progressOf(args)
      return retrieval.handler()
    },
    cancel_acquisition: () => reject('cancel_acquisition not allowed'),
  })
  await openImport()
  findButton().click()
  await settle()
  cancelButton().click()
  await settle()
  expect(cancelButton().disabled).toBe(false)
  progress.onmessage({ kind: 'requesting', gacha_type: '2', page: 1, pages: 0, records: 0 })
  await nextTick()
  expect(progressStatus()).toBe('Retrieving Departure Warp, page 1 · 0 rolls so far')
  retrieval.resolve(review(5))
  await settle()
  expect(reviewHeading().textContent).toBe('Ready to save 5 new rolls')
})

test('when the game files cannot be found, a cache file can be chosen instead', async () => {
  const calls = serve({
    extract_automatically: () => reject({ kind: 'no_cache' }),
    retrieve_history: () => review(6),
  })
  await openImport()
  findButton().click()
  await settle()
  expect(failedHeading().textContent).toBe('Couldn’t Find the Game Files')
  expect(screen('failed')!.textContent).toContain('found the game, but not its web cache')
  const retryFile = screen('failed')!.querySelector<HTMLInputElement>('input[type="file"]')!
  await choose(retryFile, new File(['synthetic'], 'data_2'))
  await settle()
  expect(flow(calls)).toEqual(['extract_automatically', 'extract_from_file', 'retrieve_history'])
  expect(reviewHeading().textContent).toBe('Ready to save 6 new rolls')
})

test('choosing a cache file extracts from it without an automatic search first', async () => {
  await openImport()
  const calls = serve({ retrieve_history: () => review(7) })
  fileInput().focus()
  await choose(fileInput(), new File(['synthetic'], 'data_2'))
  expect(progressStatus()).toBe('Reading the file, then checking with HoYoverse…')
  expect(steps()[0]).toEqual(['Find the warp history link in the provided file', 'active'])
  await settle()
  expect(flow(calls)).toEqual(['extract_from_file', 'retrieve_history'])
  expect(reviewHeading().textContent).toBe('Ready to save 7 new rolls')
  reviewButton('Discard').click()
  await settle()
  expect(document.activeElement).toBe(fileInput())
  mockIPC(() => reject({ kind: 'invalid_file' }))
  await choose(fileInput(), new File(['synthetic'], 'data_2'))
  await settle()
  expect(failedHeading().textContent).toBe('Couldn’t Read That File')
  expect(screen('failed')!.textContent).toContain(
    'That file couldn’t be read. Try choosing it again.',
  )
  // A file source cannot be retried as is, so the failure offers a file instead.
  expect(button(screen('failed')!, 'Try again')).toBeUndefined()
  await click(button(screen('failed')!, 'Back'))
  await nextTick()
  expect(document.activeElement).toBe(fileInput())
  // A change without a file, such as a cleared selection, starts nothing.
  Object.defineProperty(fileInput(), 'files', { value: [], configurable: true })
  fileInput().dispatchEvent(new Event('change'))
  await nextTick()
  expect(shown('start')).toBe(true)
})
