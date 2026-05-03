import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: afterPack } = require(path.join(repoRoot, 'scripts', 'electron-after-pack.cjs'))

describe('electron afterPack hook', () => {
  it('rebuilds required native modules inside Linux standalone resources', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-after-pack-'))
    const projectDir = path.join(tempDir, 'project')
    const appOutDir = path.join(tempDir, 'dist', 'linux-unpacked')
    const electronPkg = path.join(projectDir, 'node_modules', 'electron', 'package.json')
    const rebuildBin = path.join(projectDir, 'node_modules', '.bin', 'electron-rebuild')
    const standalonePkg = path.join(appOutDir, 'resources', '.next', 'standalone', 'node_modules', 'better-sqlite3')
    const standaloneNative = path.join(standalonePkg, 'build', 'Release', 'better_sqlite3.node')

    fs.mkdirSync(path.dirname(electronPkg), { recursive: true })
    fs.writeFileSync(electronPkg, JSON.stringify({ version: '33.4.11' }))
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
mkdir -p "$module_dir/node_modules/better-sqlite3/build/Release"
printf "electron-abi-build-%s" "$arch" > "$module_dir/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
`)
    fs.chmodSync(rebuildBin, 0o755)
    fs.mkdirSync(standalonePkg, { recursive: true })
    fs.mkdirSync(path.dirname(standaloneNative), { recursive: true })
    fs.writeFileSync(standaloneNative, 'host-node-build')

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

      assert.equal(fs.readFileSync(standaloneNative, 'utf8'), 'electron-abi-build-x64')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
