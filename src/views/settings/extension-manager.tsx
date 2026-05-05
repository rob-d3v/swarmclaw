'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '@/lib/app/api-client'
import { getExtensionSourceLabel } from '@/lib/extension-sources'
import type { ExtensionMeta, MarketplaceExtension } from '@/types'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { errorMessage } from '@/lib/shared-utils'

type ManagedResourceStatus = 'declared' | 'resolved' | 'missing' | 'missing_ref' | 'unsupported_trigger'
type ManagedResourceSummary = {
  extensions: Array<{
    extensionId: string
    extensionName: string
    enabled: boolean
    isBuiltin: boolean
    agents: Array<{ resourceKey: string; displayName: string; status: ManagedResourceStatus; resourceId: string | null }>
    schedules: Array<{ resourceKey: string; displayName: string; status: ManagedResourceStatus; resourceId: string | null }>
    localFolders: Array<{ resourceKey: string; displayName: string; status: ManagedResourceStatus; configured?: boolean; healthy?: boolean }>
    gatewayPlatforms: Array<{ platformKey: string; displayName: string; transport?: string; endpoint?: string | null }>
    setupChecks: Array<{ checkKey: string; displayName: string; kind: string; required: boolean }>
  }>
  totals: {
    extensions: number
    agents: number
    schedules: number
    localFolders: number
    gatewayPlatforms: number
    setupChecks: number
    resolvedAgents: number
    resolvedSchedules: number
    healthyLocalFolders: number
  }
}

export function ExtensionManager() {
  const [tab, setTab] = useState<'installed' | 'managed' | 'marketplace' | 'url'>('installed')
  const [extensions, setExtensions] = useState<ExtensionMeta[]>([])
  const [managedResources, setManagedResources] = useState<ManagedResourceSummary | null>(null)
  const [marketplace, setMarketplace] = useState<MarketplaceExtension[]>([])
  const [loading, setLoading] = useState(false)
  const [managedLoading, setManagedLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [reconciling, setReconciling] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlFilename, setUrlFilename] = useState('')
  const [urlStatus, setUrlStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [marketplaceQuery, setMarketplaceQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ filename: string; name: string } | null>(null)

  const loadExtensions = useCallback(async () => {
    try {
      const data = await api<ExtensionMeta[]>('GET', '/extensions')
      setExtensions(data)
    } catch { /* ignore */ }
  }, [])

  const loadManagedResources = useCallback(async () => {
    setManagedLoading(true)
    try {
      const data = await api<ManagedResourceSummary>('GET', '/extensions/managed-resources')
      setManagedResources(data)
    } catch { /* ignore */ }
    setManagedLoading(false)
  }, [])

  const loadMarketplace = useCallback(async (q = '') => {
    setLoading(true)
    try {
      const data = await api<MarketplaceExtension[]>('GET', `/extensions/marketplace?q=${encodeURIComponent(q)}`)
      if (Array.isArray(data)) setMarketplace(data)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadExtensions() }, [loadExtensions])
  useEffect(() => { if (tab === 'managed') loadManagedResources() }, [tab, loadManagedResources])
  useEffect(() => { if (tab === 'marketplace') loadMarketplace(marketplaceQuery) }, [tab, loadMarketplace, marketplaceQuery])

  const toggleExtension = async (filename: string, enabled: boolean) => {
    try {
      await api('POST', '/extensions', { filename, enabled })
      toast.success(enabled ? 'Extension enabled' : 'Extension disabled')
      loadExtensions()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle extension')
    }
  }

  const deleteExtension = async (filename: string, name: string) => {
    try {
      await api('DELETE', `/extensions?filename=${encodeURIComponent(filename)}`)
      toast.success(`Deleted ${name}`)
      loadExtensions()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const handleUpdateOne = async (id: string) => {
    setUpdating(id)
    try {
      await api('PATCH', `/extensions?id=${id}`)
      toast.success('Extension updated')
      await loadExtensions()
    } catch (err: unknown) {
      toast.error(errorMessage(err))
    } finally {
      setUpdating(null)
    }
  }

  const handleUpdateAll = async () => {
    setUpdatingAll(true)
    try {
      await api('PATCH', '/extensions?all=true')
      toast.success('All extensions updated')
      await loadExtensions()
    } catch (err: unknown) {
      toast.error(errorMessage(err))
    } finally {
      setUpdatingAll(false)
    }
  }

  const handleReconcileManaged = async (extensionId?: string) => {
    const id = extensionId || 'all'
    setReconciling(id)
    try {
      const result = await api<{ createdAgents: string[]; updatedAgents: string[]; createdSchedules: string[]; updatedSchedules: string[] }>(
        'POST',
        '/extensions/managed-resources',
        { action: 'reconcile', ...(extensionId ? { extensionId } : {}) },
        { timeoutMs: 30_000 },
      )
      await Promise.all([loadExtensions(), loadManagedResources()])
      toast.success(`Reconciled ${result.createdAgents.length + result.updatedAgents.length} agents and ${result.createdSchedules.length + result.updatedSchedules.length} schedules`)
    } catch (err: unknown) {
      toast.error(errorMessage(err))
    } finally {
      setReconciling(null)
    }
  }

  const installFromMarketplace = async (p: MarketplaceExtension) => {
    setInstalling(p.id)
    const toastId = toast.loading(`Installing ${p.name}...`)
    try {
      if (!p.url) throw new Error('No functional URL found for this extension')

      const safeFilename = `${p.id.replace(/[^a-zA-Z0-9.-]/g, '_')}.js`

      await api('POST', '/extensions/install', {
        url: p.url,
        filename: safeFilename,
        installMethod: 'marketplace',
        sourceLabel: p.source,
        installSource: p.catalogSource || p.source,
      })

      await loadExtensions()
      setTab('installed')
      toast.success(`Successfully installed ${p.name}`, { id: toastId })
    } catch (err: unknown) {
      console.error('[extension-manager] Installation failed:', err)
      toast.error(err instanceof Error ? err.message : 'Install failed', { id: toastId })
    } finally {
      setInstalling(null)
    }
  }


  const installFromUrl = async () => {
    if (!urlInput || !urlFilename) return
    setUrlStatus(null)
    setInstalling('url')
    try {
      await api('POST', '/extensions/install', { url: urlInput, filename: urlFilename })
      await loadExtensions()
      setUrlStatus({ ok: true, message: 'Installed successfully' })
      setUrlInput('')
      setUrlFilename('')
      toast.success('Extension installed from URL')
    } catch (err: unknown) {
      setUrlStatus({ ok: false, message: err instanceof Error ? err.message : 'Install failed' })
    }
    setInstalling(null)
  }

  const { coreExtensions, installedExtensions } = useMemo(() => {
    return {
      coreExtensions: extensions.filter(p => p.isBuiltin),
      installedExtensions: extensions.filter(p => !p.isBuiltin)
    }
  }, [extensions])

  const tabClass = (t: string) =>
    `py-2 px-4 rounded-[10px] text-center cursor-pointer transition-all text-[12px] font-600 border h-9 flex items-center justify-center
    ${tab === t
      ? 'bg-accent-soft border-accent-bright/25 text-accent-bright shadow-[0_0_15px_rgba(99,102,241,0.1)]'
      : 'bg-surface border-white/[0.06] text-text-3 hover:bg-surface-2 hover:border-white/[0.12]'}`

  const renderExtensionItem = (p: ExtensionMeta) => (
    <div key={p.filename} className="group flex items-center gap-4 py-3.5 px-5 rounded-[18px] bg-surface border border-white/[0.06] hover:border-white/[0.12] transition-all">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[14px] font-700 text-text truncate tracking-tight">{p.name}</span>
          <span className="text-[9px] font-mono font-700 text-text-3/40 bg-white/[0.04] px-1.5 py-0.5 rounded uppercase tracking-wider">v{p.version}</span>
          {p.openclaw && <span className="text-[9px] font-700 text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded uppercase tracking-wider border border-emerald-400/10">OpenClaw</span>}
          {p.autoDisabled && (
            <span className="text-[9px] font-700 text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider border border-amber-500/10">
              Auto-disabled
            </span>
          )}
        </div>
        <div className="text-[11px] font-mono text-text-3/40 truncate">{p.filename}</div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {p.sourceLabel && (
            <span className="text-[9px] font-700 px-1.5 py-0.5 rounded uppercase tracking-wider bg-sky-500/10 text-sky-300">
              {getExtensionSourceLabel(p.sourceLabel)}
            </span>
          )}
          {p.installSource && p.installSource !== p.sourceLabel && (
            <span className="text-[9px] font-700 px-1.5 py-0.5 rounded uppercase tracking-wider bg-white/[0.04] text-text-3/65">
              via {getExtensionSourceLabel(p.installSource)}
            </span>
          )}
        </div>
        {p.description && <div className="text-[12px] text-text-3/70 mt-1 line-clamp-1">{p.description}</div>}
        {p.hasDependencyManifest && (
          <div className="mt-1.5 flex items-center gap-2 text-[10px] font-700 uppercase tracking-[0.08em]">
            <span className="px-1.5 py-0.5 rounded bg-white/[0.04] text-text-3/70">
              {p.dependencyCount ?? 0} deps
            </span>
            <span className={`px-1.5 py-0.5 rounded ${
              p.dependencyInstallStatus === 'installed'
                ? 'bg-emerald-500/10 text-emerald-400'
                : p.dependencyInstallStatus === 'error'
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-amber-500/10 text-amber-400'
            }`}>
              {p.dependencyInstallStatus || 'ready'}
            </span>
          </div>
        )}
        {((p.managedAgentCount || 0) + (p.managedScheduleCount || 0) + (p.localFolderCount || 0) + (p.gatewayPlatformCount || 0) + (p.setupCheckCount || 0)) > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-700 uppercase tracking-[0.08em] flex-wrap">
            {(p.managedAgentCount || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">{p.managedAgentCount} agents</span>}
            {(p.managedScheduleCount || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300">{p.managedScheduleCount} routines</span>}
            {(p.localFolderCount || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300">{p.localFolderCount} folders</span>}
            {(p.gatewayPlatformCount || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300">{p.gatewayPlatformCount} gateways</span>}
          </div>
        )}
        {p.autoDisabled && (
          <div className="text-[11px] text-amber-400/90 mt-1.5 p-2 rounded-[8px] bg-amber-500/[0.03] border border-amber-500/10">
            {p.lastFailureStage ? `Error at ${p.lastFailureStage}:` : 'Last error:'} {p.lastFailureError}
          </div>
        )}
      </div>
      
      <div className="flex items-center gap-2">
        {!p.isBuiltin && (
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => handleUpdateOne(p.filename)}
              disabled={!!updating}
              className="p-2 rounded-[8px] text-text-3 hover:text-accent-bright hover:bg-accent-bright/10 transition-all border-none bg-transparent cursor-pointer"
              title="Check for updates"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={updating === p.filename ? 'animate-spin' : ''}>
                <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
              </svg>
            </button>
            <button
              onClick={() => setConfirmDelete({ filename: p.filename, name: p.name })}
              className="p-2 rounded-[8px] text-text-3 hover:text-red-400 hover:bg-red-400/10 transition-all border-none bg-transparent cursor-pointer"
              title="Uninstall extension"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M4 7l16 0" /><path d="M10 11l0 6" /><path d="M14 11l0 6" /><path d="M5 7l1 12a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2l1 -12" /><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
              </svg>
            </button>
          </div>
        )}
        <div
          onClick={() => toggleExtension(p.filename, !p.enabled)}
          className={`w-10 h-6 rounded-full transition-all duration-200 relative cursor-pointer shrink-0
            ${p.enabled ? 'bg-accent-bright' : 'bg-white/[0.08]'}`}
        >
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ${p.enabled ? 'left-5' : 'left-1'}`} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-4 mb-10">
          <div>
            <h1 className="font-display text-[32px] font-800 tracking-[-0.04em] text-text mb-1.5">Extensions</h1>
            <p className="text-[14px] text-text-3 max-w-md leading-relaxed">
              Install external extensions, browse the marketplace, and manage extension UI modules.
            </p>
          </div>
          <div className="flex bg-surface p-1.5 rounded-[14px] border border-white/[0.04]">
            <button onClick={() => setTab('installed')} className={tabClass('installed')}>Installed</button>
            <button onClick={() => setTab('managed')} className={tabClass('managed')}>Managed</button>
            <button onClick={() => setTab('marketplace')} className={tabClass('marketplace')}>Marketplace</button>
            <button onClick={() => setTab('url')} className={tabClass('url')}>Manual</button>
          </div>
        </div>

        {tab === 'installed' && (
          <div className="space-y-10">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-accent-bright animate-pulse" />
                <span className="text-[11px] font-800 uppercase tracking-[0.15em] text-text-3">Active Registry</span>
              </div>
              {installedExtensions.length > 0 && (
                <button 
                  onClick={handleUpdateAll}
                  disabled={updatingAll}
                  className="flex items-center gap-2 text-[11px] font-700 uppercase tracking-wider text-accent-bright hover:text-accent-bright/80 disabled:opacity-50 transition-all border-none bg-transparent cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className={updatingAll ? 'animate-spin' : ''}>
                    <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
                  </svg>
                  {updatingAll ? 'Updating...' : 'Update All'}
                </button>
              )}
            </div>

            {extensions.length === 0 ? (
              <div className="py-20 text-center rounded-[24px] border border-dashed border-white/[0.06]">
                <p className="text-[14px] text-text-3/50">No extensions found in the registry</p>
              </div>
            ) : (
              <div className="space-y-10">
                {coreExtensions.length > 0 && (
                  <section>
                    <div className="mb-4 px-1">
                      <h3 className="text-[13px] font-700 text-text-2">Built-in Tools</h3>
                      <p className="text-[12px] text-text-3/50 mt-0.5">Platform-owned capabilities managed outside the Extensions registry</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {coreExtensions.map(renderExtensionItem)}
                    </div>
                  </section>
                )}

                {installedExtensions.length > 0 && (
                  <section>
                    <div className="mb-4 px-1">
                      <h3 className="text-[13px] font-700 text-text-2">Extensions</h3>
                      <p className="text-[12px] text-text-3/50 mt-0.5">Custom and marketplace-installed extensions</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {installedExtensions.map(renderExtensionItem)}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'managed' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 px-1">
              <div>
                <h3 className="text-[13px] font-700 text-text-2">Managed Resources</h3>
                <p className="text-[12px] text-text-3/50 mt-0.5">Extension-declared agents, routines, folders, gateways, and setup checks.</p>
              </div>
              <button
                onClick={() => handleReconcileManaged()}
                disabled={!!reconciling || managedLoading}
                className="h-9 px-4 rounded-[10px] bg-accent-bright text-white text-[11px] font-800 uppercase tracking-[0.08em] border-none cursor-pointer disabled:opacity-50"
              >
                {reconciling === 'all' ? 'Reconciling...' : 'Reconcile All'}
              </button>
            </div>

            {managedLoading ? (
              <div className="py-20 flex justify-center">
                <div className="w-8 h-8 border-2 border-accent-bright/20 border-t-accent-bright rounded-full animate-spin" />
              </div>
            ) : !managedResources || managedResources.extensions.length === 0 ? (
              <div className="py-20 text-center rounded-[24px] border border-dashed border-white/[0.06]">
                <p className="text-[14px] text-text-3/50">No managed resource declarations found</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    ['Agents', `${managedResources.totals.resolvedAgents}/${managedResources.totals.agents}`],
                    ['Routines', `${managedResources.totals.resolvedSchedules}/${managedResources.totals.schedules}`],
                    ['Folders', `${managedResources.totals.healthyLocalFolders}/${managedResources.totals.localFolders}`],
                    ['Gateways', String(managedResources.totals.gatewayPlatforms)],
                    ['Setup', String(managedResources.totals.setupChecks)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[12px] bg-surface border border-white/[0.06] p-4">
                      <div className="text-[10px] font-800 uppercase tracking-[0.12em] text-text-3/50">{label}</div>
                      <div className="text-[22px] font-800 text-text mt-1">{value}</div>
                    </div>
                  ))}
                </div>

                {managedResources.extensions.map((entry) => (
                  <div key={entry.extensionId} className="rounded-[18px] bg-surface border border-white/[0.06] p-5">
                    <div className="flex items-center justify-between gap-4 mb-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-[14px] font-800 text-text truncate">{entry.extensionName}</h4>
                          <span className="text-[10px] font-mono text-text-3/50 truncate">{entry.extensionId}</span>
                        </div>
                        <div className="text-[11px] text-text-3/50 mt-0.5">
                          {entry.agents.length} agents, {entry.schedules.length} routines, {entry.localFolders.length} folders, {entry.gatewayPlatforms.length} gateways
                        </div>
                      </div>
                      <button
                        onClick={() => handleReconcileManaged(entry.extensionId)}
                        disabled={!!reconciling}
                        className="h-8 px-3 rounded-[9px] bg-white/[0.05] hover:bg-white/[0.08] text-text-2 text-[10px] font-800 uppercase tracking-[0.08em] border border-white/[0.06] cursor-pointer disabled:opacity-50"
                      >
                        {reconciling === entry.extensionId ? 'Reconciling...' : 'Reconcile'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        ['Agents', entry.agents.map((item) => `${item.displayName} - ${item.status}`)],
                        ['Routines', entry.schedules.map((item) => `${item.displayName} - ${item.status}`)],
                        ['Folders', entry.localFolders.map((item) => `${item.displayName} - ${item.configured ? 'configured' : 'missing'}`)],
                      ].map(([label, rows]) => (
                        <div key={label as string} className="rounded-[12px] bg-bg/60 border border-white/[0.04] p-3 min-h-[96px]">
                          <div className="text-[10px] font-800 uppercase tracking-[0.12em] text-text-3/50 mb-2">{label as string}</div>
                          {(rows as string[]).length > 0 ? (
                            <div className="space-y-1">
                              {(rows as string[]).slice(0, 4).map((row) => (
                                <div key={row} className="text-[11px] text-text-3/80 truncate">{row}</div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[11px] text-text-3/35">None</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'marketplace' && (
          <div className="space-y-6">
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-3 group-focus-within:text-accent-bright transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
              </div>
              <input
                type="text"
                value={marketplaceQuery}
                onChange={(e) => setMarketplaceQuery(e.target.value)}
                placeholder="Search ClawHub & SwarmClaw Registry..."
                className="w-full h-14 pl-11 pr-4 bg-surface border border-white/[0.08] rounded-[18px] text-[15px] text-text outline-none focus:border-accent-bright/40 focus:bg-surface-2 transition-all shadow-sm"
                style={{ fontFamily: 'inherit' }}
              />
            </div>

            {loading ? (
              <div className="py-20 flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-2 border-accent-bright/20 border-t-accent-bright rounded-full animate-spin" />
                <p className="text-[12px] text-text-3/70 animate-pulse uppercase tracking-[0.1em] font-700">Searching registries...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {marketplace.map((p) => (
                  <div key={p.id} className="p-6 rounded-[22px] bg-surface border border-white/[0.06] flex items-start gap-6 hover:border-white/[0.12] transition-all">
                    <div className="w-12 h-12 rounded-[14px] bg-accent-bright/[0.03] border border-accent-bright/10 flex items-center justify-center shrink-0">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-accent-bright">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className="text-[16px] font-700 text-text tracking-tight">{p.name}</span>
                        {p.source && (
                          <span className="text-[9px] font-800 uppercase px-2 py-0.5 rounded-[6px] border bg-sky-500/10 text-sky-300 border-sky-500/20">
                            {getExtensionSourceLabel(p.source)}
                          </span>
                        )}
                        {p.catalogSource && p.catalogSource !== p.source && (
                          <span className="text-[9px] font-800 uppercase px-2 py-0.5 rounded-[6px] border bg-white/[0.04] text-text-3/70 border-white/[0.08]">
                            via {getExtensionSourceLabel(p.catalogSource)}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-text-3/80 leading-relaxed mb-4 line-clamp-2">{p.description}</p>
                      
                      <div className="flex items-center gap-4">
                        <div className="text-[11px] text-text-3/40 font-600 uppercase tracking-wider flex items-center gap-1.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
                          </svg>
                          v{p.version || '1.0.0'}
                        </div>
                        {p.author && (
                          <div className="text-[11px] text-text-3/40 font-600 uppercase tracking-wider flex items-center gap-1.5">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                            </svg>
                            {p.author}
                          </div>
                        )}
                        <a 
                          href={p.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[11px] text-accent-bright/60 hover:text-accent-bright font-700 uppercase tracking-widest no-underline transition-colors ml-auto flex items-center gap-1"
                        >
                          Source
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                            <path d="M17 7l-10 10" /><path d="M8 7l9 0l0 9" />
                          </svg>
                        </a>
                      </div>
                    </div>
                    <button
                      disabled={!!installing}
                      onClick={() => installFromMarketplace(p)}
                      className={`px-6 py-2.5 rounded-[14px] font-display text-[13px] font-700 transition-all active:scale-[0.97] shrink-0
                        ${installing === p.id 
                          ? 'bg-white/[0.04] text-text-3 animate-pulse' 
                          : 'bg-accent-bright text-white shadow-[0_0_20px_rgba(56,189,248,0.2)] hover:bg-accent-bright/90 hover:shadow-[0_0_25px_rgba(56,189,248,0.3)]'}`}
                      style={{ fontFamily: 'inherit' }}
                    >
                      {installing === p.id ? '...' : 'Install'}
                    </button>
                  </div>
                ))}
                {marketplace.length === 0 && (
                  <div className="py-20 text-center opacity-40">
                    <p className="text-[15px] font-600 mb-1">No results for &quot;{marketplaceQuery}&quot;</p>
                    <p className="text-[12px]">Try searching for generic terms like &quot;wallet&quot;, &quot;social&quot;, or &quot;files&quot;</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'url' && (
          <div className="max-w-2xl mx-auto mt-10 p-8 rounded-[28px] bg-surface border border-white/[0.06] shadow-xl">
            <h2 className="text-[18px] font-800 text-text mb-6 flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-accent-bright">
                <path d="M10 14l11 -11" /><path d="M21 3l-6.5 18a0.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a0.55 .55 0 0 1 0 -1l18 -6.5" />
              </svg>
              Install from source URL
            </h2>
            <div className="space-y-5">
              <div>
                <label className="block text-[11px] font-700 text-text-3 uppercase tracking-widest mb-2.5 ml-1">JavaScript URL (HTTPS)</label>
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/my-extension.js"
                  className="w-full h-12 px-4 bg-bg border border-white/[0.08] rounded-[14px] text-[14px] text-text outline-none focus:border-accent-bright/40 focus:ring-4 focus:ring-accent-bright/5 transition-all"
                  style={{ fontFamily: 'inherit' }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-700 text-text-3 uppercase tracking-widest mb-2.5 ml-1">Target Filename</label>
                <input
                  type="text"
                  value={urlFilename}
                  onChange={(e) => setUrlFilename(e.target.value)}
                  placeholder="my-extension.js"
                  className="w-full h-12 px-4 bg-bg border border-white/[0.08] rounded-[14px] text-[14px] text-text outline-none focus:border-accent-bright/40 focus:ring-4 focus:ring-accent-bright/5 transition-all"
                  style={{ fontFamily: 'inherit' }}
                />
              </div>
              <button
                onClick={installFromUrl}
                disabled={!urlInput || !urlFilename || installing === 'url'}
                className="w-full h-12 bg-accent-bright text-white rounded-[14px] text-[14px] font-800 shadow-lg shadow-accent-bright/20 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontFamily: 'inherit' }}
              >
                {installing === 'url' ? 'Installing...' : 'Install Extension'}
              </button>
            </div>
            {urlStatus && (
              <div className={`mt-5 p-4 rounded-[14px] flex items-center gap-3 text-[13px] font-600 border ${urlStatus.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                <div className={`w-2 h-2 rounded-full ${urlStatus.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                {urlStatus.message}
              </div>
            )}
            <p className="text-[11px] text-text-3/40 mt-6 leading-relaxed text-center italic">
              SwarmClaw supports `.js` / `.mjs` extensions, native SwarmClaw hooks/tools, and OpenClaw activate/register formats.
            </p>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Extension"
        message={confirmDelete ? `Delete "${confirmDelete.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!confirmDelete) return
          void deleteExtension(confirmDelete.filename, confirmDelete.name)
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
