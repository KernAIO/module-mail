import type { Kernel } from '@kernaio/kernel'
import { uuidv7 } from '@kernaio/kernel'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { suppressions } from './schema.js'

export interface SuppressionEntry {
  workspaceId: string | null
  email: string
  reason: 'bounce' | 'complaint' | 'manual'
  source?: string | null
}

/** Split recipients into deliverable and suppressed. Pure — used by the send path and tests. */
export function filterSuppressed(
  recipients: string[],
  suppressed: ReadonlySet<string>,
): { deliverable: string[]; suppressed: string[] } {
  const out = { deliverable: [] as string[], suppressed: [] as string[] }
  for (const r of recipients) (suppressed.has(r.toLowerCase()) ? out.suppressed : out.deliverable).push(r)
  return out
}

/** Addresses suppressed for this workspace (or instance-wide) among `emails`. */
export async function loadSuppressed(
  kernel: Kernel,
  workspaceId: string | null,
  emails: string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set()
  const lower = emails.map((e) => e.toLowerCase())
  const rows = await kernel.database.withWorkspace(null, (tx) =>
    tx
      .select({ email: suppressions.email })
      .from(suppressions)
      .where(
        and(
          inArray(suppressions.email, lower),
          workspaceId
            ? or(eq(suppressions.workspaceId, workspaceId), isNull(suppressions.workspaceId))
            : isNull(suppressions.workspaceId),
        ),
      ),
  )
  return new Set(rows.map((r) => r.email))
}

/** Record a suppression (idempotent per workspace + email). */
export async function addSuppression(kernel: Kernel, entry: SuppressionEntry): Promise<void> {
  const email = entry.email.toLowerCase()
  await kernel.database.withWorkspace(null, async (tx) => {
    const existing = await tx
      .select({ id: suppressions.id })
      .from(suppressions)
      .where(
        and(
          eq(suppressions.email, email),
          entry.workspaceId
            ? eq(suppressions.workspaceId, entry.workspaceId)
            : isNull(suppressions.workspaceId),
        ),
      )
      .limit(1)
    if (existing.length > 0) return
    await tx.insert(suppressions).values({
      id: uuidv7(),
      workspaceId: entry.workspaceId,
      email,
      reason: entry.reason,
      source: entry.source ?? null,
    })
  })
}
