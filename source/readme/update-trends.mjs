import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repository = 'ArtlexYoung/dsh-super-code'
const packageName = 'dsh-super-code'
const dayMs = 86_400_000
const number = value => value.toLocaleString('en-US')
const round = value => Number(value.toFixed(2))

function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid statistics date')
  }
  return Date.parse(value)
}

export function aggregateDownloads(data) {
  if (data?.package !== packageName || !Array.isArray(data.downloads) || data.downloads.length < 91) {
    throw new Error('Incomplete npm download statistics')
  }
  const days = data.downloads.slice(-91)
  for (const [i, row] of days.entries()) {
    const date = parseDay(row?.day)
    if (!Number.isSafeInteger(row.downloads) || row.downloads < 0
      || (i > 0 && date - parseDay(days[i - 1].day) !== dayMs)) {
      throw new Error('Invalid npm download statistics')
    }
  }
  if (days.at(-1).day !== data.end) throw new Error('Incomplete npm download period')
  return Array.from({ length: 13 }, (_, i) => ({
    day: days[i * 7 + 6].day,
    value: days.slice(i * 7, i * 7 + 7).reduce((sum, row) => sum + row.downloads, 0),
  }))
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Statistics request failed: HTTP ${response.status}`)
  return response.json()
}

function parseStarPage(stars, first, last) {
  if (!Array.isArray(stars) || stars.length > 100) throw new Error('Invalid GitHub stargazers')
  return stars.map(star => {
    if (typeof star?.starred_at !== 'string') throw new Error('Missing GitHub star timestamp')
    const day = star.starred_at.slice(0, 10), date = parseDay(day)
    if (date < first || date > last) throw new Error('Invalid GitHub star date')
    return day
  })
}

function accumulateStars(counts, firstDay, lastDay) {
  let total = 0
  const rows = [{ day: firstDay, value: 0 }]
  for (const day of [...counts.keys()].sort()) {
    total += counts.get(day)
    rows.push({ day, value: total })
  }
  if (rows.at(-1).day !== lastDay) rows.push({ day: lastDay, value: total })
  return rows
}

export async function fetchStars(now = new Date(), token = process.env.GITHUB_TOKEN) {
  const headers = { Accept: 'application/vnd.github.star+json', 'X-GitHub-Api-Version': '2022-11-28' }
  if (token) headers.Authorization = `Bearer ${token}`
  const base = `https://api.github.com/repos/${repository}`
  const repo = await fetchJson(base, headers)
  if (repo?.full_name !== repository || typeof repo.created_at !== 'string') {
    throw new Error('Invalid GitHub repository statistics')
  }
  const firstDay = repo.created_at.slice(0, 10)
  const lastDay = now.toISOString().slice(0, 10)
  const first = parseDay(firstDay), last = parseDay(lastDay)
  if (first > last) throw new Error('Invalid GitHub statistics period')
  const counts = new Map()
  for (let page = 1; ; page++) {
    const stars = parseStarPage(await fetchJson(`${base}/stargazers?per_page=100&page=${page}`, headers), first, last)
    for (const day of stars) {
      counts.set(day, (counts.get(day) ?? 0) + 1)
    }
    if (stars.length < 100) break
  }
  return accumulateStars(counts, firstDay, lastDay)
}

function renderChart({ title, subtitle, rows, color, summary, source }, dark) {
  const colors = dark
    ? { bg: '#0d1117', border: '#30363d', text: '#e6edf3', muted: '#9da7b3', grid: '#212830' }
    : { bg: '#ffffff', border: '#d8dee4', text: '#1f2328', muted: '#59636e', grid: '#e8ecf0' }
  const left = 68, right = 926, top = 85, bottom = 260
  const first = Date.parse(rows[0].day), last = Date.parse(rows.at(-1).day)
  const highest = Math.max(1, ...rows.map(row => row.value))
  const rough = highest / 4, power = 10 ** Math.floor(Math.log10(rough))
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map(v => v * power).find(v => v >= rough))
  const ceiling = Math.ceil(highest / step) * step
  const x = day => round(left + (right - left) * (Date.parse(day) - first) / Math.max(last - first, dayMs))
  const y = value => round(bottom - (bottom - top) * value / ceiling)
  const points = rows.map(row => `${x(row.day)},${y(row.value)}`).join(' ')
  const grid = Array.from({ length: Math.round(ceiling / step) + 1 }, (_, i) => {
    const value = i * step
    return `<path d="M${left} ${y(value)}H${right}" stroke="${colors.grid}"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${number(value)}</text>`
  }).join('\n')
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const day = new Date(first + (last - first) * i / 4).toISOString().slice(0, 10)
    return `<text x="${x(day)}" y="285" text-anchor="middle">${day.slice(5).replace('-', '/')}</text>`
  }).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="320" viewBox="0 0 960 320" role="img" aria-labelledby="title description">
<title id="title">${packageName} ${title}</title>
<desc id="description">${subtitle}. ${summary}. Through ${rows.at(-1).day}. Source: ${source}.</desc>
<style>text{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;fill:${colors.muted};font-variant-numeric:tabular-nums}</style>
<rect x=".5" y=".5" width="959" height="319" rx="12" fill="${colors.bg}" stroke="${colors.border}"/>
<text x="28" y="35" style="font-size:19px;font-weight:600;fill:${colors.text}">${title}</text>
<text x="28" y="58">${subtitle}</text>
<text x="932" y="35" text-anchor="end" style="font-size:19px;font-weight:600;fill:${colors.text}">${summary}</text>
<text x="932" y="58" text-anchor="end">Through ${rows.at(-1).day}</text>
${grid}
<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${x(rows.at(-1).day)}" cy="${y(rows.at(-1).value)}" r="3.5" fill="${color}"/>
${ticks}
<text x="28" y="307">Source: ${source}</text>
</svg>\n`
}

export async function updateTrends(output = resolve(import.meta.dirname, '../../docs/images')) {
  // 两个来源均成功后才写图，接口故障时保留原图。
  const [stars, npm] = await Promise.all([
    fetchStars(),
    fetchJson(`https://api.npmjs.org/downloads/range/last-year/${packageName}`),
  ])
  const weeks = aggregateDownloads(npm)
  const charts = [
    { name: 'star-history', title: 'Star history', subtitle: repository, rows: stars,
      color: '#e3a008', summary: `${number(stars.at(-1).value)} stars`, source: 'GitHub' },
    { name: 'npm-downloads', title: 'npm downloads', subtitle: `${packageName} · weekly · last 13 weeks`, rows: weeks,
      color: '#e05d58', summary: `${number(weeks.at(-1).value)} last 7 days`, source: 'npm' },
  ]
  const images = charts.flatMap(chart => [false, true].map(dark => ({
    name: `${chart.name}${dark ? '-dark' : ''}.svg`, svg: renderChart(chart, dark),
  })))
  await mkdir(output, { recursive: true })
  for (const image of images) await writeFile(resolve(output, image.name), image.svg)
  return images.map(image => image.name)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const images = await updateTrends()
  console.log(`Updated ${images.join(', ')}`)
}
