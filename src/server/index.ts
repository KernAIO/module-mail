import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { core } from '@kernhq/contracts'
import {
  defineModule,
  defineServerModule,
  KernError,
  type Kernel,
  requires,
  uuidv7,
  workspaceScoped,
} from '@kernhq/kernel'
import { implement } from '@orpc/server'
import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import {
  type MailDelivery,
  MODULE_ID,
  mailContract,
  mailEvents,
  mailPermissions,
  SECRET_PLACEHOLDER,
  SendMailInput,
} from '../contract.js'
import { deliveries, schema } from './schema.js'
import { buildMessage, instanceName, processSend, resolveConfig } from './send.js'
import { maskConfig, unmaskConfig } from './settings.js'
import { addSuppression } from './suppressions.js'
import { renderTemplate } from './templates.js'

export * from './providers/index.js'
export * from './schema.js'
export * from './send.js'
export * from './settings.js'
export * from './suppressions.js'
export * from './templates.js'

const SEND_JOB = 'send'
const iso = (d: Date) => d.toISOString()

/**
 * Queues an email. Every caller — this module's own API, other modules through `kernel.call('mail.send')`
 * and the core service's account emails — goes through here, so delivery, retries, suppression and the
 * audit trail behave identically no matter who sent the message.
 */
export async function queueSend(
  kernel: Kernel,
  input: SendMailInput,
): Promise<{ deliveryId: string; status: string }> {
  const message = SendMailInput.parse(input)
  const config = await resolveConfig(kernel, message.workspaceId)
  const built = await buildMessage(kernel, message, fromAddress(config))
  const deliveryId = uuidv7()
  await kernel.database.db.insert(deliveries).values({
    id: deliveryId,
    workspaceId: message.workspaceId ?? null,
    to: message.to,
    subject: built.subject,
    provider: config?.provider ?? 'platform',
    template: message.template?.name ?? null,
    status: 'queued',
    tags: message.tags ?? [],
  })
  await kernel.jobs.send(`${MODULE_ID}.${SEND_JOB}`, { deliveryId, message })
  return { deliveryId, status: 'queued' }
}

/** The envelope sender for a workspace's configured provider, or the instance default. */
function fromAddress(config: core.MailProviderConfig | null): string {
  if (config && 'from' in config && typeof config.from === 'string') return config.from
  return process.env.MAIL_FROM ?? `${instanceName()} <no-reply@localhost>`
}

const os = implement(mailContract).$context<import('@kernhq/kernel').RequestContext>()

function mailRouter(kernel: Kernel) {
  const scoped = os.use(workspaceScoped(MODULE_ID))
  return os.router({
    settings: {
      get: scoped.settings.get.use(requires('mail.settings.manage')).handler(async ({ input }) => {
        const stored = await kernel.settings.integration<core.MailProviderConfig>(input.workspaceId, 'mail')
        return { config: stored ? maskConfig(stored) : null }
      }),
      set: scoped.settings.set.use(requires('mail.settings.manage')).handler(async ({ input }) => {
        if (input.config === null) {
          await kernel.settings.setIntegration(input.workspaceId, 'mail', null)
          return { ok: true }
        }
        const previous = await kernel.settings.integration<core.MailProviderConfig>(input.workspaceId, 'mail')
        // secrets come back from the client as placeholders; keep whatever is already stored
        const merged = unmaskConfig(input.config, previous ?? null)
        await kernel.settings.setIntegration(input.workspaceId, 'mail', merged)
        return { ok: true }
      }),
      test: scoped.settings.test.use(requires('mail.settings.manage')).handler(async ({ input }) => {
        try {
          await queueSend(kernel, {
            workspaceId: input.workspaceId,
            to: [input.to],
            subject: `${instanceName()} test message`,
            template: { name: 'test', data: { instanceName: instanceName() } },
          })
          return { ok: true, error: null }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }),
    },
    deliveries: {
      list: scoped.deliveries.list.use(requires('mail.deliveries.view')).handler(async ({ input }) => {
        const where = [eq(deliveries.workspaceId, input.workspaceId)]
        if (input.status) where.push(eq(deliveries.status, input.status))
        if (input.cursor) where.push(lt(deliveries.id, input.cursor))
        const rows = await kernel.database.db
          .select()
          .from(deliveries)
          .where(and(...where))
          .orderBy(desc(deliveries.id))
          .limit(input.limit + 1)
        const items: MailDelivery[] = rows.slice(0, input.limit).map((r) => ({
          id: r.id,
          workspaceId: r.workspaceId as MailDelivery['workspaceId'],
          to: r.to,
          subject: r.subject,
          provider: r.provider as MailDelivery['provider'],
          template: r.template,
          status: r.status as MailDelivery['status'],
          providerMessageId: r.providerMessageId,
          error: r.error,
          tags: r.tags,
          createdAt: iso(r.createdAt),
          updatedAt: iso(r.updatedAt),
        }))
        const nextCursor = rows.length > input.limit ? (items.at(-1)?.id ?? null) : null
        return { items, nextCursor }
      }),
    },
  })
}

/**
 * The mail module: outbound email for the whole platform. Providers are configured per workspace
 * (SMTP, Mailgun, SES, Postmark, Resend) and fall back to the instance's own SMTP settings, so a
 * self-hosted install works with nothing but `SMTP_URL`.
 */
export const mailModule = defineServerModule({
  definition: defineModule({
    id: MODULE_ID,
    name: 'Mail',
    version: '0.1.0',
    description: 'Outbound email: per-workspace providers, templates, delivery log and suppressions',
    icon: 'mail',
    core: false,
    defaultHost: 'mail',
    permissions: mailPermissions,
    events: mailEvents,
  }),
  schema,
  migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '../../migrations'),
  router: mailRouter,

  jobs: [
    {
      name: SEND_JOB,
      schema: z.object({ deliveryId: z.uuid(), message: SendMailInput }),
      options: { retryLimit: 5, retryDelay: 30, retryBackoff: true },
      handler: async (input, { kernel }) => processSend(kernel, input),
    },
  ],

  procedures: {
    /** Send an email. Used by core for account mail and by any module that needs to notify people. */
    send: {
      input: SendMailInput,
      output: z.object({ deliveryId: z.string(), status: z.string() }),
      handler: (input, { kernel }) => queueSend(kernel, input),
    },
    /** Render a template without sending it — used for previews and tests. */
    render: {
      input: z.object({ name: z.string(), data: z.record(z.string(), z.unknown()).default({}) }),
      output: z.object({ subject: z.string(), html: z.string(), text: z.string() }),
      handler: (input) => renderTemplate(input.name, input.data, { instanceName: instanceName() }),
    },
    /** Record a bounce or complaint so later sends skip the address. */
    suppress: {
      input: z.object({
        workspaceId: z.string().nullable().default(null),
        email: z.string(),
        reason: z.string(),
      }),
      handler: async (input, { kernel }) => {
        await addSuppression(kernel, {
          workspaceId: input.workspaceId,
          email: input.email,
          reason: input.reason,
        })
        return { ok: true }
      },
    },
  },

  /** Provider webhooks are mounted by the mail service (see `repos/mail/src/webhooks.ts`). */
  onBoot: (kernel) => {
    kernel.log.info({ module: MODULE_ID }, 'mail module ready')
  },
})

export { MODULE_ID, mailContract, mailEvents, mailPermissions, SECRET_PLACEHOLDER }
export default mailModule

/** Guard used by the service when a provider webhook arrives for an unknown delivery. */
export function requireDelivery<T>(row: T | undefined | null): T {
  if (!row) throw KernError.notFound('Delivery')
  return row
}
