#!/usr/bin/env node
/**
 * Validate plugin / theme manifests and build installable Kiwi zip packages.
 *
 * Usage:
 *   node scripts/package.mjs           # validate + build dist/<key>-<version>.zip
 *   node scripts/package.mjs --check   # validate only
 *
 * Component zips keep plugin.json / index.js / style.css / README.md at the
 * root. Theme zips keep plugin.json / theme.css / README.md / assets/** at the
 * root; Kiwi rejects nested-only archives and manifest files larger than 1 MB.
 */
import { access, mkdir, readFile, readdir, unlink, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pluginsDir = path.join(root, 'plugins')
const themesDir = path.join(root, 'themes')
const distDir = path.join(root, 'dist')
const checkOnly = process.argv.includes('--check')
const REQUIRED_FILES = ['plugin.json', 'index.js']
const OPTIONAL_FILES = ['style.css', 'README.md']
const THEME_REQUIRED_FILES = ['plugin.json']
const THEME_OPTIONAL_FILES = ['theme.css', 'README.md']
// 当前两个计时器以跨页面使用为核心场景；后续新增插件可按区块自行决定是否置顶。
const PINNABLE_REQUIRED_KEYS = new Set(['pomodoro', 'countdown'])
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024
const MAX_STYLE_BYTES = 512 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_IMPORT_BYTES = 64 * 1024 * 1024
const MAX_ASSET_BYTES = 4 * 1024 * 1024
const MAX_VIDEO_ASSET_BYTES = 48 * 1024 * 1024
const MAX_ASSETS_TOTAL_BYTES = 60 * 1024 * 1024
const MAX_ASSET_COUNT = 40
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const KEY = /^[a-z0-9][a-z0-9-]{1,63}$/
const THEME_MODES = new Set(['light', 'dark'])
const THEME_COLOR_KEYS = new Set([
  'app.background',
  'surface.background',
  'surface.muted',
  'surface.strong',
  'border.subtle',
  'border.default',
  'border.strong',
  'text.primary',
  'text.strong',
  'text.secondary',
  'text.muted',
  'text.subtle',
  'text.faint',
  'accent',
  'accent.foreground',
])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv', '.ogg', '.mov'])
const ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.avif',
  '.bmp',
  '.woff2',
  '.woff',
  '.ttf',
  '.otf',
  ...VIDEO_EXTENSIONS,
])

function fail(message) {
  throw new Error(message)
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function validatePlugin(dir) {
  const manifestPath = path.join(dir, 'plugin.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    fail(`${dir}: cannot read plugin.json (${error.message})`)
  }

  if (manifest.manifest_version !== 1) {
    fail(`${manifest.key || dir}: manifest_version must be 1`)
  }
  if (manifest.kind !== 'component') {
    fail(`${manifest.key || dir}: kind must be "component"`)
  }
  if (!KEY.test(manifest.key || '')) {
    fail(`${dir}: invalid key "${manifest.key}"`)
  }
  if (!SEMVER.test(manifest.version || '')) {
    fail(`${manifest.key}: version must be semver, got "${manifest.version}"`)
  }
  if (!Array.isArray(manifest.blocks) || manifest.blocks.length === 0) {
    fail(`${manifest.key}: blocks must contain at least one block`)
  }

  const blockTypes = new Set()
  for (const block of manifest.blocks) {
    if (!block.type || blockTypes.has(block.type)) {
      fail(`${manifest.key}: duplicate or missing block type "${block.type}"`)
    }
    blockTypes.add(block.type)
    if (block.pinnable !== undefined && typeof block.pinnable !== 'boolean') {
      fail(`${manifest.key}:${block.type}: pinnable must be a boolean`)
    }
    if (PINNABLE_REQUIRED_KEYS.has(manifest.key) && block.pinnable !== true) {
      // The two timers exist for cross-page use; keep the contract explicit so
      // packaging never silently drops the feature. Other plugins may opt out.
      fail(`${manifest.key}:${block.type}: pinnable must be true`)
    }
  }

  for (const file of REQUIRED_FILES) {
    if (!(await exists(path.join(dir, file)))) {
      fail(`${manifest.key}: missing required file ${file}`)
    }
  }
  for (const file of [manifest.entry || 'index.js', manifest.style].filter(Boolean)) {
    if (!(await exists(path.join(dir, file)))) {
      fail(`${manifest.key}: entry/style file not found: ${file}`)
    }
  }

  const entrySize = (await stat(path.join(dir, manifest.entry || 'index.js'))).size
  if (entrySize > MAX_SCRIPT_BYTES) {
    fail(`${manifest.key}: entry script exceeds 2 MB (${entrySize} bytes)`)
  }
  if (manifest.style) {
    const styleSize = (await stat(path.join(dir, manifest.style))).size
    if (styleSize > MAX_STYLE_BYTES) {
      fail(`${manifest.key}: style exceeds 512 KB (${styleSize} bytes)`)
    }
  }

  return { dir, manifest, files: [...REQUIRED_FILES, ...OPTIONAL_FILES] }
}

async function walkFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full, base)))
    } else if (entry.isFile()) {
      files.push(path.relative(base, full).split(path.sep).join('/'))
    }
  }
  return files
}

function validateCssToken(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${label} must be a non-empty string`)
  }
  if (value.length > 120) fail(`${label} is longer than 120 characters`)
  if (/[;{}<>]/.test(value)) fail(`${label} contains invalid characters`)
}

function resolveAsset(dir, value, label, extensions = ASSET_EXTENSIONS) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^(https?:|data:)/.test(text)) return ''
  const relative = text.replace(/\\/g, '/').replace(/^\/+/, '')
  if (relative.split('/').includes('..')) {
    fail(`${label} must stay inside the theme directory`)
  }
  const normalized = relative.startsWith('assets/') ? relative : `assets/${relative}`
  const full = path.join(dir, normalized)
  if (!extensions.has(path.extname(normalized).toLowerCase())) {
    fail(`${label} has an unsupported file type: ${normalized}`)
  }
  return full
}

async function validateTheme(dir) {
  const manifestPath = path.join(dir, 'plugin.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    fail(`${dir}: cannot read plugin.json (${error.message})`)
  }

  if (manifest.manifest_version !== 1) {
    fail(`${manifest.key || dir}: manifest_version must be 1`)
  }
  if (manifest.kind !== 'theme') {
    fail(`${manifest.key || dir}: kind must be "theme"`)
  }
  if (!KEY.test(manifest.key || '')) {
    fail(`${dir}: invalid key "${manifest.key}"`)
  }
  if (!SEMVER.test(manifest.version || '')) {
    fail(`${manifest.key}: version must be semver, got "${manifest.version}"`)
  }
  if (!manifest.name || !String(manifest.name).trim()) {
    fail(`${manifest.key}: name is required`)
  }
  if (manifest.entry) {
    fail(`${manifest.key}: theme packages must not declare entry`)
  }
  if (Array.isArray(manifest.blocks) && manifest.blocks.length) {
    fail(`${manifest.key}: theme packages must not declare blocks`)
  }

  for (const file of THEME_REQUIRED_FILES) {
    if (!(await exists(path.join(dir, file)))) {
      fail(`${manifest.key}: missing required file ${file}`)
    }
  }

  const manifestSize = (await stat(manifestPath)).size
  if (manifestSize > MAX_MANIFEST_BYTES) {
    fail(`${manifest.key}: plugin.json exceeds 1 MB`)
  }

  const theme = manifest.theme
  if (!theme || typeof theme !== 'object') {
    fail(`${manifest.key}: theme spec is required`)
  }
  if (!THEME_MODES.has(theme.mode || 'light')) {
    fail(`${manifest.key}: theme.mode must be "light" or "dark"`)
  }
  const colors = theme.colors || {}
  if (typeof colors !== 'object' || Array.isArray(colors)) {
    fail(`${manifest.key}: theme.colors must be an object`)
  }
  for (const [token, value] of Object.entries(colors)) {
    if (!THEME_COLOR_KEYS.has(token)) {
      fail(`${manifest.key}: unknown color token "${token}"`)
    }
    validateCssToken(value, `${manifest.key}:${token}`)
  }

  const stylePath = manifest.style || 'theme.css'
  const styleExists = await exists(path.join(dir, stylePath))
  if (manifest.style && !styleExists) {
    fail(`${manifest.key}: style file not found: ${stylePath}`)
  }
  if (!Object.keys(colors).length && !styleExists) {
    fail(`${manifest.key}: theme needs colors or theme.css`)
  }
  if (styleExists) {
    const styleSize = (await stat(path.join(dir, stylePath))).size
    if (styleSize > MAX_STYLE_BYTES) {
      fail(`${manifest.key}: theme.css exceeds 512 KB (${styleSize} bytes)`)
    }
  }

  const background = theme.background || {}
  for (const [value, label, extensions] of [
    [background.image, `${manifest.key}: background.image`, ASSET_EXTENSIONS],
    [background.video, `${manifest.key}: background.video`, VIDEO_EXTENSIONS],
    [theme.preview, `${manifest.key}: preview`, ASSET_EXTENSIONS],
  ]) {
    const full = resolveAsset(dir, value, label, extensions)
    if (full && !(await exists(full))) {
      fail(`${label} file not found: ${value}`)
    }
  }

  const assetsDir = path.join(dir, 'assets')
  if (await exists(assetsDir)) {
    const files = await walkFiles(assetsDir, dir)
    if (files.length > MAX_ASSET_COUNT) {
      fail(`${manifest.key}: more than ${MAX_ASSET_COUNT} assets`)
    }
    let total = 0
    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      if (!ASSET_EXTENSIONS.has(ext)) {
        fail(`${manifest.key}: unsupported asset type: ${file}`)
      }
      const size = (await stat(path.join(dir, file))).size
      const limit = VIDEO_EXTENSIONS.has(ext) ? MAX_VIDEO_ASSET_BYTES : MAX_ASSET_BYTES
      if (size > limit) {
        fail(
          `${manifest.key}: asset exceeds ${limit / 1024 / 1024} MB: ${file}`,
        )
      }
      total += size
    }
    if (total > MAX_ASSETS_TOTAL_BYTES) {
      fail(`${manifest.key}: assets exceed 60 MB in total`)
    }
  }

  return { dir, manifest, stylePath: styleExists ? stylePath : '' }
}

async function buildZip(item, theme = false) {
  const { dir, manifest } = item
  await mkdir(distDir, { recursive: true })
  const out = path.join(distDir, `${manifest.key}-${manifest.version}.zip`)
  if (await exists(out)) await unlink(out)

  // Only include files that actually exist; README/style are optional.
  const present = []
  const candidates = theme ? THEME_REQUIRED_FILES : REQUIRED_FILES
  for (const file of candidates) present.push(file)
  const optional = theme
    ? [item.stylePath, ...THEME_OPTIONAL_FILES].filter(Boolean)
    : OPTIONAL_FILES
  for (const file of optional) {
    if (!present.includes(file) && (await exists(path.join(dir, file)))) {
      present.push(file)
    }
  }
  if (await exists(path.join(dir, 'assets'))) present.push('assets')

  const args = ['-q', '-X']
  if (theme) args.push('-r')
  const result = spawnSync('zip', [...args, out, ...present], {
    cwd: dir,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    fail(`${manifest.key}: zip failed: ${result.stderr || result.stdout || 'unknown error'}`)
  }
  const size = (await stat(out)).size
  if (size > MAX_IMPORT_BYTES) {
    fail(`${manifest.key}: package exceeds 64 MB (${size} bytes)`)
  }
  return out
}

async function collectPlugins() {
  if (!(await exists(pluginsDir))) return []
  const entries = (await readdir(pluginsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const items = []
  for (const name of entries) {
    const dir = path.join(pluginsDir, name)
    if (!(await exists(path.join(dir, 'plugin.json')))) continue
    items.push(await validatePlugin(dir))
  }
  return items
}

async function collectThemes() {
  if (!(await exists(themesDir))) return []
  const entries = (await readdir(themesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const items = []
  for (const name of entries) {
    const dir = path.join(themesDir, name)
    if (!(await exists(path.join(dir, 'plugin.json')))) continue
    items.push(await validateTheme(dir))
  }
  return items
}

const plugins = await collectPlugins()
const themes = await collectThemes()

if (!plugins.length && !themes.length) {
  fail('no plugin or theme directories found')
}

const built = []
for (const plugin of plugins) {
  const { manifest } = plugin
  if (checkOnly) {
    console.log(`✓ component ${manifest.key} ${manifest.version}`)
  } else {
    const out = await buildZip(plugin)
    built.push(out)
    console.log(`✓ component ${manifest.key} ${manifest.version} → ${path.relative(root, out)}`)
  }
}
for (const theme of themes) {
  const { manifest } = theme
  if (checkOnly) {
    console.log(`✓ theme     ${manifest.key} ${manifest.version}`)
  } else {
    const out = await buildZip(theme, true)
    built.push(out)
    console.log(`✓ theme     ${manifest.key} ${manifest.version} → ${path.relative(root, out)}`)
  }
}

if (!checkOnly) console.log(`\nBuilt ${built.length} package(s) in dist/.`)
