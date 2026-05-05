import { NextResponse } from 'next/server'
import { safeParseBody } from '@/lib/server/safe-parse-body'
import {
  inspectExtensionLocalFolder,
  listExtensionLocalFolderEntries,
  listExtensionManagedResources,
  reconcileExtensionManagedResources,
  setExtensionLocalFolderConfig,
} from '@/lib/server/extension-managed-resources'
import { errorMessage } from '@/lib/shared-utils'
import '@/lib/server/builtin-extensions'

export const dynamic = 'force-dynamic'

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  try {
    if (action === 'inspect_local_folder') {
      const extensionId = optionalText(searchParams.get('extensionId'))
      const folderKey = optionalText(searchParams.get('folderKey'))
      if (!extensionId || !folderKey) return badRequest('extensionId and folderKey required')
      return NextResponse.json(await inspectExtensionLocalFolder({
        extensionId,
        folderKey,
      }))
    }

    if (action === 'list_local_folder') {
      const extensionId = optionalText(searchParams.get('extensionId'))
      const folderKey = optionalText(searchParams.get('folderKey'))
      if (!extensionId || !folderKey) return badRequest('extensionId and folderKey required')
      return NextResponse.json(await listExtensionLocalFolderEntries({
        extensionId,
        folderKey,
        relativePath: optionalText(searchParams.get('relativePath')),
        recursive: searchParams.get('recursive') === 'true',
        maxEntries: Number(searchParams.get('maxEntries') || 1000),
      }))
    }

    return NextResponse.json(listExtensionManagedResources())
  } catch (err: unknown) {
    return badRequest(errorMessage(err))
  }
}

export async function POST(req: Request) {
  const { data: body, error } = await safeParseBody(req)
  if (error) return error
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const action = optionalText(input.action)

  try {
    if (action === 'reconcile') {
      return NextResponse.json(reconcileExtensionManagedResources(optionalText(input.extensionId)))
    }

    if (action === 'configure_local_folder') {
      const extensionId = optionalText(input.extensionId)
      const folderKey = optionalText(input.folderKey)
      const folderPath = optionalText(input.path)
      if (!extensionId || !folderKey || !folderPath) {
        return badRequest('extensionId, folderKey, and path required')
      }
      const access = input.access === 'read' || input.access === 'readWrite'
        ? input.access
        : undefined
      const config = setExtensionLocalFolderConfig({
        extensionId,
        folderKey,
        path: folderPath,
        access,
      })
      const status = await inspectExtensionLocalFolder({ extensionId, folderKey })
      return NextResponse.json({ ok: true, config, status })
    }

    if (action === 'inspect_local_folder') {
      const extensionId = optionalText(input.extensionId)
      const folderKey = optionalText(input.folderKey)
      if (!extensionId || !folderKey) return badRequest('extensionId and folderKey required')
      return NextResponse.json(await inspectExtensionLocalFolder({
        extensionId,
        folderKey,
        overridePath: optionalText(input.path),
      }))
    }

    if (action === 'list_local_folder') {
      const extensionId = optionalText(input.extensionId)
      const folderKey = optionalText(input.folderKey)
      if (!extensionId || !folderKey) return badRequest('extensionId and folderKey required')
      return NextResponse.json(await listExtensionLocalFolderEntries({
        extensionId,
        folderKey,
        relativePath: optionalText(input.relativePath),
        recursive: input.recursive === true,
        maxEntries: typeof input.maxEntries === 'number' ? input.maxEntries : undefined,
      }))
    }

    return badRequest('action required')
  } catch (err: unknown) {
    return badRequest(errorMessage(err))
  }
}
