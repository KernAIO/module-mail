import type { core, EventDef } from '@kernhq/contracts'
import type { Kernel } from '@kernhq/kernel'
import { KernError } from '@kernhq/kernel'
import { eq } from 'drizzle-orm'
import { type MailDeliveryStatus, mailEvents, type SendMailInput } from '../contract.js'
import { providerFor } from './providers/index.js'
import type { MailProvider, OutgoingMessage } from './providers/types.js'
import { ALL_WORKSPACES, deliveries } from './schema.js'
import { filterSuppressed, loadSuppressed } from './suppressions.js'
import { renderPlainText, renderTemplate } from './templates.js'

export const instanceName = () => process.env.KERN_INSTANCE_NAME ?? 'Kern'

/**
 * The error a delivery carries when the blocked list took every recipient.
 *
 * Written on the row and read back by the test send, which tells the administrator to look at the
 * blocked addresses rather than at the credentials. It is a constant so the two ends cannot drift
 * apart, and the wording is unchanged from when it was a literal here.
 */
export const ALL_SUPPRESSED = 'all recipients suppressed'

/** Workspace integration config (`core.settings.getIntegration` kind `mail`) or null → platform SMTP. */
export async function resolveConfig(
  kernel: Kernel,
  workspaceId: string | undefined,
): Promise<core.MailProviderConfig | null> {
  if (!workspaceId) return null
  return kernel.settings.integration<core.MailProviderConfig>(workspaceId, 'mail')
}

export async function resolveProvider(
  kernel: Kernel,
  workspaceId: string | undefined,
): Promise<MailProvider> {
  return providerFor(await resolveConfig(kernel, workspaceId))
}

/** Render template (when set), fetch attachments, apply suppressions → message ready to send. */
export async function buildMessage(
  kernel: Kernel,
  input: SendMailInput,
  from: string,
): Promise<OutgoingMessage> {
  let { subject, text, html } = { subject: input.subject, text: input.text, html: input.html }
  if (input.template) {
    const rendered = await renderTemplate(input.template.name, input.template.data, {
      instanceName: instanceName(),
    })
    html = rendered.html
    text = text ?? rendered.text
    if (!input.subject.trim()) subject = rendered.subject
  }
  if (!text && !html) throw new KernError('BAD_REQUEST', 'One of text, html or template is required')
  // A caller that knows no template name still gets the platform's own design: text with no HTML
  // beside it goes out in the shared paper layout as well. Core's notification digest is exactly
  // that shape, and it is the email most people here actually read.
  if (text && !html) html = await renderPlainText(text, { instanceName: instanceName() })

  const attachments = await Promise.all(
    (input.attachments ?? []).map(async (a) => {
      if (a.base64)
        return { filename: a.filename, contentType: a.contentType, content: Buffer.from(a.base64, 'base64') }
      const file = await kernel.call<core.FileObject>('core.files.get', {
        workspaceId: input.workspaceId,
        id: a.fileId,
      })
      const obj = await kernel.storage.get(file.key)
      const chunks: Buffer[] = []
      for await (const chunk of obj.body) chunks.push(Buffer.from(chunk as Uint8Array))
      return {
        filename: a.filename,
        contentType: a.contentType ?? file.mimeType,
        content: Buffer.concat(chunks),
      }
    }),
  )

  return {
    from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    replyTo: input.replyTo,
    subject,
    text,
    html,
    headers: input.headers,
    attachments: attachments.length ? attachments : undefined,
    tags: input.tags,
  }
}

export async function updateDelivery(
  kernel: Kernel,
  deliveryId: string,
  patch: { status?: MailDeliveryStatus; providerMessageId?: string | null; error?: string | null },
): Promise<void> {
  // The job runs for every workspace at once, and an instance-level delivery has none.
  await kernel.database.withWorkspace(ALL_WORKSPACES, (tx) =>
    tx
      .update(deliveries)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(deliveries.id, deliveryId)),
  )
}

export async function emitDeliveryEvent(
  kernel: Kernel,
  def: EventDef,
  row: { id: string; workspaceId: string | null; to: string[] },
  extra: { providerMessageId?: string | null; error?: string | null } = {},
): Promise<void> {
  await kernel.emit(
    def,
    {
      deliveryId: row.id,
      workspaceId: row.workspaceId,
      to: row.to,
      providerMessageId: extra.providerMessageId ?? null,
      error: extra.error ?? null,
    },
    { workspaceId: row.workspaceId },
  )
}

/**
 * `mail.send` job: resolve provider, drop suppressed recipients, send, record the outcome.
 * Throws on provider errors so pg-boss retries with backoff; the delivery row tracks the last error.
 */
export async function processSend(
  kernel: Kernel,
  job: { deliveryId: string; message: SendMailInput },
): Promise<void> {
  const { deliveryId, message } = job
  const workspaceId = message.workspaceId ?? null
  const suppressed = await loadSuppressed(kernel, workspaceId, [
    ...message.to,
    ...(message.cc ?? []),
    ...(message.bcc ?? []),
  ])
  const to = filterSuppressed(message.to, suppressed).deliverable
  if (to.length === 0) {
    await updateDelivery(kernel, deliveryId, { status: 'failed', error: ALL_SUPPRESSED })
    await emitDeliveryEvent(
      kernel,
      mailEvents.deliveryFailed,
      { id: deliveryId, workspaceId, to: message.to },
      { error: ALL_SUPPRESSED },
    )
    return
  }
  // Inside the try, not before it: building the provider is where a wrong host, a missing key or an
  // instance with no SMTP_URL at all throws, and a throw out here left the row saying `queued` for
  // ever — the delivery log's silence on the most common misconfiguration there is.
  let provider: MailProvider | undefined
  try {
    provider = await resolveProvider(kernel, message.workspaceId)
    const outgoing = await buildMessage(kernel, { ...message, to }, provider.from)
    outgoing.cc = message.cc ? filterSuppressed(message.cc, suppressed).deliverable : undefined
    outgoing.bcc = message.bcc ? filterSuppressed(message.bcc, suppressed).deliverable : undefined
    const result = await provider.send(outgoing)
    await updateDelivery(kernel, deliveryId, {
      status: 'sent',
      providerMessageId: result.messageId,
      error: null,
    })
    await emitDeliveryEvent(
      kernel,
      mailEvents.deliverySent,
      { id: deliveryId, workspaceId, to },
      { providerMessageId: result.messageId },
    )
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await updateDelivery(kernel, deliveryId, { status: 'failed', error })
    await emitDeliveryEvent(kernel, mailEvents.deliveryFailed, { id: deliveryId, workspaceId, to }, { error })
    throw err
  } finally {
    provider?.close?.()
  }
}

/** What a caller learns from a send it waited for. */
export interface SendOutcome {
  deliveryId: string
  ok: boolean
  /** the provider's own words when it refused, or why nothing was sent */
  error: string | null
  status: MailDeliveryStatus
}

/**
 * Send now and answer what actually happened, rather than that it was queued.
 *
 * The delivery row is the answer, not the absence of a throw: `processSend` returns normally when
 * every recipient is suppressed, and it throws *after* recording the provider's refusal, so the two
 * outcomes are only distinguishable by reading the row back. That is the whole difference between
 * this and `queueSend` — anything that reports success without having sent teaches an administrator
 * that a green result means nothing.
 */
export async function sendNow(
  kernel: Kernel,
  deliveryId: string,
  message: SendMailInput,
): Promise<SendOutcome> {
  let thrown: string | null = null
  try {
    await processSend(kernel, { deliveryId, message })
  } catch (err) {
    thrown = err instanceof Error ? err.message : String(err)
  }
  const [row] = await kernel.database.withWorkspace(ALL_WORKSPACES, (tx) =>
    tx
      .select({ status: deliveries.status, error: deliveries.error })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .limit(1),
  )
  const status = (row?.status ?? 'queued') as MailDeliveryStatus
  if (status === 'sent') return { deliveryId, ok: true, error: null, status }
  return { deliveryId, ok: false, error: row?.error ?? thrown, status }
}
