#!/usr/bin/env node
/**
 * Validate both plugin manifests and build installable Kiwi zip packages.
 *
 * Usage:
 *   node scripts/package.mjs           # validate + build dist/<key>-<version>.zip
 *   node scripts/package.mjs --check   # validate only
 *
 * The zip must keep plugin.json / index.js / style.css / README.md at its root;
 * Kiwi rejects nested-only archives and manifest files larger than 1 MB.
 */
import { access, mkdir, readFile, readdir, unlink, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pluginsDir = path.join(root, 'plugins')
const distDir = path.join(root, 'dist')
const checkOnly = process.argv.includes('--check')
const REQUIRED_FILES = ['plugin.json', 'index.js']
const OPTIONAL_FILES = ['style.css', 'README.md']
// 当前两个计时器以跨页面使用为核心场景；后续新增插件可按区块自行决定是否置顶。
const PINNABLE_REQUIRED_KEYS = new Set(['pomodoro', 'countdown'])
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024
const MAX_STYLE_BYTES = 512 * 1024
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const KEY = /^[a-z0-9][a-z0-9-]{1,63}$/

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

async function buildZip(plugin) {
  const { dir, manifest } = plugin
  await mkdir(distDir, { recursive: true })
  const out = path.join(distDir, `${manifest.key}-${manifest.version}.zip`)
  if (await exists(out)) await unlink(out)

  // Only include files that actually exist; README/style are optional.
  const present = []
  for (const file of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
    if (await exists(path.join(dir, file))) present.push(file)
  }

  const result = spawnSync('zip', ['-q', '-X', out, ...present], {
    cwd: dir,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    fail(`${manifest.key}: zip failed: ${result.stderr || result.stdout || 'unknown error'}`)
  }
  return out
}

const entries = (await readdir(pluginsDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

if (!entries.length) fail('no plugin directories found under plugins/')

const built = []
for (const name of entries) {
  const dir = path.join(pluginsDir, name)
  if (!(await exists(path.join(dir, 'plugin.json')))) continue
  const plugin = await validatePlugin(dir)
  if (checkOnly) {
    console.log(`✓ ${plugin.manifest.key} ${plugin.manifest.version} (manifest valid)`)
  } else {
    const out = await buildZip(plugin)
    built.push(out)
    console.log(`✓ ${plugin.manifest.key} ${plugin.manifest.version} → ${path.relative(root, out)}`)
  }
}

if (!checkOnly) console.log(`\nBuilt ${built.length} package(s) in dist/.`)
