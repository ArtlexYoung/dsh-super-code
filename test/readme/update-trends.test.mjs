import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { aggregateDownloads, fetchStars, updateTrends } from '../../source/readme/update-trends.mjs'

function downloads() {
  return {
    package: 'dsh-super-code', end: '2026-04-01',
    downloads: Array.from({ length: 91 }, (_, i) => ({
      day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), downloads: i,
    })),
  }
}

const repo = { full_name: 'ArtlexYoung/dsh-super-code', created_at: '2026-01-01T00:00:00Z' }
const star = { starred_at: '2026-01-02T12:00:00Z' }

function mockFetch(t, handler) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const result = await handler(String(url), options)
    return result instanceof Response ? result : Response.json(result)
  }
  t.after(() => { globalThis.fetch = original })
}

test('按连续七天汇总最近十三周，并保留零下载周', () => {
  const raw = downloads()
  assert.deepEqual(aggregateDownloads(raw)[0], { day: '2026-01-07', value: 21 })
  const weeks = aggregateDownloads(raw)
  assert.equal(weeks.length, 13)
  assert.equal(weeks.at(-1).day, raw.end)
  assert.equal(weeks.reduce((sum, row) => sum + row.value, 0), 4095)
  for (const row of raw.downloads) row.downloads = 0
  assert.ok(aggregateDownloads(raw).every(row => row.value === 0))
})

test('拒绝缺失、重复日期、无效日期、非法下载量和不完整周期', () => {
  const changes = [
    raw => { raw.package = 'another-package' },
    raw => { raw.downloads.pop() },
    raw => { raw.downloads[5].day = raw.downloads[4].day },
    raw => { raw.downloads[0].day = '2026-02-30' },
    raw => { raw.downloads[0].downloads = -1 },
    raw => { raw.downloads[0].downloads = 0.5 },
    raw => { raw.end = '2026-04-02' },
  ]
  for (const change of changes) {
    const raw = downloads()
    change(raw)
    assert.throws(() => aggregateDownloads(raw))
  }
  assert.throws(() => aggregateDownloads(null))
})

test('Star 分页不丢数据，按日期排序汇总并延伸至当天', async t => {
  const pages = []
  mockFetch(t, (url, options) => {
    assert.equal(options.headers.Accept, 'application/vnd.github.star+json')
    if (!url.includes('/stargazers')) return repo
    const page = Number(new URL(url).searchParams.get('page'))
    pages.push(page)
    return page === 1 ? Array(100).fill(star) : [{ starred_at: '2026-01-01T06:00:00Z' }]
  })
  const rows = await fetchStars(new Date('2026-01-03T00:00:00Z'), '')
  assert.deepEqual(pages, [1, 2])
  assert.deepEqual(rows, [
    { day: '2026-01-01', value: 0 }, { day: '2026-01-01', value: 1 },
    { day: '2026-01-02', value: 101 }, { day: '2026-01-03', value: 101 },
  ])
})

test('没有 Star 时仍生成有效时间序列', async t => {
  mockFetch(t, url => url.includes('/stargazers') ? [] : repo)
  assert.deepEqual(await fetchStars(new Date('2026-01-01T12:00:00Z'), ''), [{ day: '2026-01-01', value: 0 }])
})

test('非法 Star 数据会报错，不当作零 Star', async t => {
  mockFetch(t, url => url.includes('/stargazers') ? [{}] : repo)
  await assert.rejects(fetchStars(new Date('2026-01-03'), ''), /timestamp/)
})

async function chartDirectory(t) {
  const root = resolve(import.meta.dirname, '../../source/validation')
  await mkdir(root, { recursive: true })
  const path = await mkdtemp(resolve(root, 'readme-trends-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

test('任何来源请求失败时，原来的四张图保持不变', async t => {
  const output = await chartDirectory(t)
  const names = ['star-history.svg', 'star-history-dark.svg', 'npm-downloads.svg', 'npm-downloads-dark.svg']
  for (const name of names) await writeFile(resolve(output, name), `original ${name}`)
  mockFetch(t, url => url.includes('api.npmjs.org') ? new Response('Unavailable', { status: 503 }) : repo)
  await assert.rejects(updateTrends(output), /HTTP 503/)
  for (const name of names) assert.equal(await readFile(resolve(output, name), 'utf8'), `original ${name}`)
})

test('生成紧凑的明暗主题图，重复运行相同数据不会变化', async t => {
  const output = await chartDirectory(t)
  mockFetch(t, url => url.includes('api.npmjs.org') ? downloads() : url.includes('/stargazers') ? [] : repo)
  const names = await updateTrends(output)
  assert.equal(names.length, 4)
  const before = await Promise.all(names.map(name => readFile(resolve(output, name), 'utf8')))
  for (const svg of before) {
    assert.match(svg, /width="960" height="320"/)
    assert.match(svg, /<polyline/)
    assert.doesNotMatch(svg, /xkcd|NaN|Infinity/)
  }
  assert.match(before[0], /fill="#ffffff"/)
  assert.match(before[1], /fill="#0d1117"/)
  await updateTrends(output)
  const after = await Promise.all(names.map(name => readFile(resolve(output, name), 'utf8')))
  assert.deepEqual(after, before)
})
