'use strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

// Native modules that load inside the Electron child process. Rebuild these in
// the packaged standalone tree for the target Electron ABI/arch; do not let
// electron-builder rebuild every native dependency in root node_modules because
// transitive N-API packages can force brittle source builds that the app does
// not load from the desktop standalone path.
const STANDALONE_REBUILD_MODULES = [
  'better-sqlite3',
  'utf-8-validate',
]

function readElectronVersion(projectDir) {
  const electronPkg = path.join(projectDir, 'node_modules', 'electron', 'package.json')
  const raw = fs.readFileSync(electronPkg, 'utf8')
  return JSON.parse(raw).version
}

function rebuildStandaloneNativeModules(projectDir, standaloneDir, archName) {
  const modules = STANDALONE_REBUILD_MODULES.filter((moduleName) => fs.existsSync(path.join(standaloneDir, 'node_modules', moduleName)))
  if (modules.length === 0) return

  const electronRebuild = path.join(
    projectDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild',
  )
  const electronVersion = readElectronVersion(projectDir)
  const cacheDir = path.join(projectDir, '.tmp-electron-rebuild-cache')
  const result = spawnSync(
    electronRebuild,
    [
      '--version', electronVersion,
      '--module-dir', standaloneDir,
      '--only', modules.join(','),
      '--arch', archName,
      '--sequential',
      '--force',
      '--disable-pre-gyp-copy',
    ],
    {
      cwd: projectDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        npm_config_cache: process.env.npm_config_cache || cacheDir,
      },
    },
  )
  if (result.status !== 0) {
    throw new Error(`afterPack: electron-rebuild failed with status ${result.status}`)
  }
}

function resolveResourcesDir(context) {
  const appName = context.packager.appInfo.productFilename
  if (context.electronPlatformName === 'darwin') {
    return path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources')
  }
  return path.join(context.appOutDir, 'resources')
}

function signMacApp(context) {
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  console.log(`[after-pack] ad-hoc signing ${appPath}`)
  const codesign = spawnSync(
    'codesign',
    [
      '--sign', '-',
      '--force',
      '--deep',
      '--timestamp=none',
      '--preserve-metadata=entitlements,requirements,flags,runtime',
      appPath,
    ],
    { stdio: 'inherit' },
  )
  if (codesign.status !== 0) {
    throw new Error(`afterPack: codesign ad-hoc failed with status ${codesign.status}`)
  }
}

exports.default = async function afterPack(context) {
  const projectDir = context.packager.info.projectDir
  const standaloneDir = path.join(resolveResourcesDir(context), '.next', 'standalone')
  const archName = ARCH_NAMES[context.arch]
  if (!archName) throw new Error(`afterPack: unknown arch ${context.arch}`)

  console.log(`[after-pack] rebuilding required standalone native modules for arch=${archName}`)
  rebuildStandaloneNativeModules(projectDir, standaloneDir, archName)

  if (context.electronPlatformName === 'darwin') signMacApp(context)
}
