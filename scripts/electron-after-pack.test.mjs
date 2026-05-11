import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const {
  default: afterPack,
  validateStandaloneNativeModuleArch,
} = require(path.join(repoRoot, 'scripts', 'electron-after-pack.cjs'))

describe('electron afterPack hook', () => {
  it('rebuilds required native modules inside Linux standalone resources', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-after-pack-'))
    const projectDir = path.join(tempDir, 'project')
    const appOutDir = path.join(tempDir, 'dist', 'linux-unpacked')
    const electronPkg = path.join(projectDir, 'node_modules', 'electron', 'package.json')
    const rebuildBin = path.join(projectDir, 'node_modules', '.bin', 'electron-rebuild')
    const sourcePkg = path.join(projectDir, 'node_modules', 'better-sqlite3')
    const standalonePkg = path.join(appOutDir, 'resources', '.next', 'standalone', 'node_modules', 'better-sqlite3')
    const standaloneNative = path.join(standalonePkg, 'build', 'Release', 'better_sqlite3.node')

    fs.mkdirSync(path.dirname(electronPkg), { recursive: true })
    fs.writeFileSync(electronPkg, JSON.stringify({ version: '33.4.11' }))
    fs.mkdirSync(path.join(sourcePkg, 'src'), { recursive: true })
    fs.mkdirSync(path.join(sourcePkg, 'build', 'Release'), { recursive: true })
    fs.writeFileSync(path.join(sourcePkg, 'package.json'), JSON.stringify({ name: 'better-sqlite3' }))
    fs.writeFileSync(path.join(sourcePkg, 'binding.gyp'), '{}')
    fs.writeFileSync(path.join(sourcePkg, 'src', 'addon.cpp'), '// source')
    fs.writeFileSync(path.join(sourcePkg, 'build', 'Release', 'better_sqlite3.node'), 'host-arch')
    fs.mkdirSync(path.dirname(rebuildBin), { recursive: true })
    fs.writeFileSync(rebuildBin, `#!/bin/sh
set -eu
module_dir=""
arch=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --module-dir) module_dir="$2"; shift 2 ;;
    --arch) arch="$2"; shift 2 ;;
    *) shift ;;
  esac
done
test -f "$module_dir/node_modules/better-sqlite3/binding.gyp"
test ! -f "$module_dir/node_modules/better-sqlite3/build/Release/stale.node"
mkdir -p "$module_dir/node_modules/better-sqlite3/build/Release"
printf "electron-abi-build-%s env:%s/%s" "$arch" "$npm_config_arch" "$npm_config_target_arch" > "$module_dir/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
project_dir="$(cd "$(dirname "$0")/../.." && pwd)"
printf "mutated-root-%s" "$arch" > "$project_dir/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
`)
    fs.chmodSync(rebuildBin, 0o755)
    fs.mkdirSync(standalonePkg, { recursive: true })
    fs.mkdirSync(path.dirname(standaloneNative), { recursive: true })
    fs.writeFileSync(standaloneNative, 'host-node-build')
    fs.writeFileSync(path.join(path.dirname(standaloneNative), 'stale.node'), 'stale')

    try {
      await afterPack({
        electronPlatformName: 'linux',
        arch: 1,
        appOutDir,
        packager: {
          info: { projectDir },
          appInfo: { productFilename: 'SwarmClaw' },
        },
      })

      assert.equal(fs.readFileSync(standaloneNative, 'utf8'), 'electron-abi-build-x64 env:x64/x64')
      assert.equal(
        fs.readFileSync(path.join(sourcePkg, 'build', 'Release', 'better_sqlite3.node'), 'utf8'),
        'host-arch',
      )
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects a macOS x64 package that contains an arm64-only required native module', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-after-pack-arch-'))
    const standaloneDir = path.join(tempDir, 'standalone')
    const nativePath = path.join(standaloneDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
    const binDir = path.join(tempDir, 'bin')

    fs.mkdirSync(path.dirname(nativePath), { recursive: true })
    fs.writeFileSync(nativePath, 'fake-native')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, 'file'), `#!/bin/sh
printf '%s: Mach-O 64-bit bundle arm64\\n' "$1"
`)
    fs.chmodSync(path.join(binDir, 'file'), 0o755)

    const oldPath = process.env.PATH
    process.env.PATH = `${binDir}${path.delimiter}${oldPath || ''}`
    try {
      assert.throws(
        () => validateStandaloneNativeModuleArch(standaloneDir, 'x64'),
        /expected x86_64/,
      )
    } finally {
      process.env.PATH = oldPath
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
