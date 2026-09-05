import {
  baseContract,
  defineEvent,
  definePermissions,
  Email,
  PageInput,
  page,
  Timestamp,
  WorkspaceId,
} from '@kernhq/contracts'
import { z } from 'zod'

export const MODULE_ID = 'mail'

/** Value returned in place of a secret field when reading settings; sending it back keeps the stored value. */
export const SECRET_PLACEHOLDER = '__kern_secret__'

export const MailProviderKind = z.enum(['platform', 'smtp', 'mailgun', 'ses', 'postmark', 'resend'])
export type MailProviderKind = z.infer<typeof MailProviderKind>

export const MailAttachment = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: z.string().default('application/octet-stream'),
    /** id of a file stored in core files (fetched at send time) */
    fileId: z.uuid().optional(),
    /** inline content, base64-encoded (small attachments only) */
    base64: z.string().optional(),
  })
  .refine((a) => Boolean(a.fileId) !== Boolean(a.base64), {
    message: 'exactly one of fileId or base64 is required',
  })
export type MailAttachment = z.infer<typeof MailAttachment>

export const SendMailInput = z.object({
  /** omitted for instance-level mail (signup verification…): the platform provider is used */
  workspaceId: WorkspaceId.optional(),
  to: z.array(Email).min(1).max(50),
  cc: z.array(Email).max(50).optional(),
  bcc: z.array(Email).max(50).optional(),
  subject: z.string().min(1).max(500),
  text: z.string().optional(),
  html: z.string().optional(),
  /** render a named MJML template with `data` instead of passing text/html */
  template: z.object({ name: z.string(), data: z.record(z.string(), z.unknown()).default({}) }).optional(),
  replyTo: Email.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  attachments: z.array(MailAttachment).max(20).optional(),
  /** free-form tags stored on the delivery (e.g. `digest`, `invite`) */
  tags: z.array(z.string().max(64)).max(10).optional(),
})
export type SendMailInput = z.infer<typeof SendMailInput>

export const MailDeliveryStatus = z.enum(['queued', 'sent', 'failed', 'bounced'])
export type MailDeliveryStatus = z.infer<typeof MailDeliveryStatus>

export const MailDelivery = z.object({
  id: z.uuid(),
  workspaceId: WorkspaceId.nullable(),
  to: z.array(z.string()),
  subject: z.string(),
  provider: MailProviderKind,
  template: z.string().nullable(),
  status: MailDeliveryStatus,
  providerMessageId: z.string().nullable(),
  error: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type MailDelivery = z.infer<typeof MailDelivery>

/**
 * How a test send ended, when it did not end in the message being accepted.
 *
 * `suppressed` is the one worth naming separately: the address is on the blocked list, the provider
 * was never asked, and the fix is on the same screen rather than in the credentials.
 */
export const MailTestStatus = z.enum(['refused', 'suppressed', 'timeout'])
export type MailTestStatus = z.infer<typeof MailTestStatus>

export const MailSuppression = z.object({
  id: z.uuid(),
  workspaceId: WorkspaceId.nullable(),
  email: z.string(),
  reason: z.enum(['bounce', 'complaint', 'manual']),
  source: z.string().nullable(),
  createdAt: Timestamp,
})
export type MailSuppression = z.infer<typeof MailSuppression>

const ws = z.object({ workspaceId: WorkspaceId })

/**
 * Workspace mail settings as exposed over the API. Secret fields are replaced with
 * SECRET_PLACEHOLDER on read; sending the placeholder back keeps the stored secret.
 * The stored shape is `core.MailProviderConfig` (contracts).
 */
export const mailContract = {
  settings: {
    get: baseContract
      .route({ method: 'GET', path: '/settings', tags: ['mail'] })
      .input(ws)
      .output(z.object({ config: z.record(z.string(), z.unknown()).nullable() })),
    set: baseContract
      .route({ method: 'PUT', path: '/settings', tags: ['mail'] })
      .input(ws.extend({ config: z.record(z.string(), z.unknown()).nullable() }))
      .output(z.object({ ok: z.boolean() })),
    test: baseContract
      .route({ method: 'POST', path: '/settings/test', tags: ['mail'] })
      .input(ws.extend({ to: Email }))
      .output(
        z.object({
          ok: z.boolean(),
          /** the provider's own words when it refused; null when there were none */
          error: z.string().nullable(),
          /**
           * Why it did not arrive, so the screen can say something a person can act on rather than
           * repeating a provider's wording. Absent when the message was accepted.
           */
          status: MailTestStatus.optional(),
        }),
      ),
  },
  deliveries: {
    list: baseContract
      .route({ method: 'GET', path: '/deliveries', tags: ['mail'] })
      .input(ws.extend(PageInput.shape).extend({ status: MailDeliveryStatus.optional() }))
      .output(page(MailDelivery)),
  },
  /**
   * The addresses this workspace may not send to, and the way back off the list.
   *
   * A hard bounce, a full mailbox or one press of "report spam" writes a row here for ever, and
   * until this existed nothing in the product could read it or take it away: an address that
   * bounced once stopped receiving password resets, sign-in links and invitations, and only SQL
   * released it. A workspace sees its own rows and the instance-wide ones — the instance-wide ones
   * are the account mail, so leaving them out would leave the worst case unreachable.
   */
  suppressions: {
    list: baseContract
      .route({ method: 'GET', path: '/suppressions', tags: ['mail'] })
      .input(ws.extend(PageInput.shape).extend({ q: z.string().max(320).optional() }))
      .output(page(MailSuppression)),
    remove: baseContract
      .route({ method: 'DELETE', path: '/suppressions/{id}', tags: ['mail'] })
      .input(ws.extend({ id: z.uuid() }))
      .output(z.object({ ok: z.boolean() })),
  },
}
export type MailContract = typeof mailContract

const deliveryEvent = z.object({
  deliveryId: z.uuid(),
  workspaceId: WorkspaceId.nullable(),
  to: z.array(z.string()),
  providerMessageId: z.string().nullable(),
  error: z.string().nullable(),
})
export const mailEvents = {
  deliverySent: defineEvent('mail.delivery.sent', deliveryEvent),
  deliveryFailed: defineEvent('mail.delivery.failed', deliveryEvent),
  deliveryBounced: defineEvent('mail.delivery.bounced', deliveryEvent),
}

export const mailPermissions = definePermissions([
  {
    key: 'mail.settings.manage',
    label: 'Manage mail settings',
    scope: 'workspace',
    defaultRoles: ['owner', 'admin'],
    dangerous: true,
  },
  {
    key: 'mail.deliveries.view',
    label: 'View mail deliveries',
    scope: 'workspace',
    defaultRoles: ['owner', 'admin'],
    dangerous: false,
  },
])
