import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { core } from '@kernhq/contracts'
import {
  defineModule,
  defineServerModule,
  KernError,
  type Kernel,
  packageVersion,
  requires,
  uuidv7,
  workspaceScoped,
} from '@kernhq/kernel'
import { implement } from '@orpc/server'
import { and, desc, eq, ilike, isNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import {
  type MailDelivery,
  type MailSuppression,
  MODULE_ID,
  mailContract,
  mailEvents,
  mailPermissions,
  SECRET_PLACEHOLDER,
  SendMailInput,
} from '../contract.js'
import { ALL_WORKSPACES, deliveries, schema, suppressions } from './schema.js'
import {
  ALL_SUPPRESSED,
  buildMessage,
  instanceName,
  processSend,
  resolveConfig,
  type SendOutcome,
  sendNow,
} from './send.js'
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
 * How long the test send waits before it answers "no answer" instead of holding the request open.
 *
 * A wrong SMTP host does not refuse, it hangs, and nodemailer's own connection timeout is minutes —
 * long enough that the browser gives up first and the administrator is told nothing at all.
 */
const TEST_SEND_DEADLINE_MS = 20_000
const TIMED_OUT = Symbol('timed out')

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms)
  })
  // The send is not cancelled, only stopped being waited on: whatever the provider eventually says
  // still lands on the delivery row, which is where the screen looks next.
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

/**
 * Queues an email. Every caller — this module's own API, other modules through `kernel.call('mail.send')`
 * and the core service's account emails — goes through here, so delivery, retries, suppression and the
 * audit trail behave identically no matter who sent the message.
 */
export async function queueSend(
  kernel: Kernel,
  input: SendMailInput,
): Promise<{ deliveryId: string; status: string }> {
  const { deliveryId, message } = await recordDelivery(kernel, input)
  await kernel.jobs.send(`${MODULE_ID}.${SEND_JOB}`, { deliveryId, message })
  return { deliveryId, status: 'queued' }
}

/**
 * Validate the message and write its `queued` row — everything both send paths share.
 *
 * Rendering the message here as well as in the job is deliberate: a template that does not exist,
 * an attachment that is not readable and a message with no body at all are answered to the caller
 * rather than discovered by a background job nobody is watching.
 */
async function recordDelivery(
  kernel: Kernel,
  input: SendMailInput,
): Promise<{ deliveryId: string; message: SendMailInput }> {
  const message = SendMailInput.parse(input)
  const config = await resolveConfig(kernel, message.workspaceId)
  const built = await buildMessage(kernel, message, fromAddress(config))
  const deliveryId = uuidv7()
  // Bound to every workspace rather than to the message's: an instance-level message (a sign-in
  // link, before there is a workspace) has no workspace, and the policy admits it only this way.
  await kernel.database.withWorkspace(ALL_WORKSPACES, (tx) =>
    tx.insert(deliveries).values({
      id: deliveryId,
      workspaceId: message.workspaceId ?? null,
      to: message.to,
      subject: built.subject,
      provider: config?.provider ?? 'platform',
      template: message.template?.name ?? null,
      status: 'queued',
      tags: message.tags ?? [],
    }),
  )
  return { deliveryId, message }
}

/**
 * Send a message and wait for the answer, for the one caller that is asking whether mail works.
 *
 * `queueSend` is right for everything else — a slow provider must not hold a request open — but a
 * test send that reports success because a job was enqueued proves nothing at all.
 */
export async function sendAndWait(kernel: Kernel, input: SendMailInput): Promise<SendOutcome> {
  const { deliveryId, message } = await recordDelivery(kernel, input)
  return sendNow(kernel, deliveryId, message)
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
      /**
       * The one control whose entire job is to prove that mail works, so it has to send.
       *
       * It used to enqueue the message and answer `ok` — success for credentials that could not
       * connect, for a recipient on the suppression list, for an instance with no provider at all.
       * An administrator saw a green toast and walked away. Now the provider is built and used
       * inside the handler and the answer is the delivery's own outcome, in the provider's words.
       */
      test: scoped.settings.test.use(requires('mail.settings.manage')).handler(async ({ input }) => {
        const config = await kernel.settings.integration<core.MailProviderConfig>(input.workspaceId, 'mail')
        try {
          const outcome = await withDeadline(
            sendAndWait(kernel, {
              workspaceId: input.workspaceId,
              to: [input.to],
              subject: `${instanceName()} test message`,
              template: {
                name: 'test',
                data: { instanceName: instanceName(), provider: config?.provider ?? 'platform' },
              },
            }),
            TEST_SEND_DEADLINE_MS,
          )
          if (outcome === TIMED_OUT) return { ok: false, error: null, status: 'timeout' as const }
          if (outcome.ok) return { ok: true, error: null }
          return {
            ok: false,
            error: outcome.error,
            status: outcome.error === ALL_SUPPRESSED ? ('suppressed' as const) : ('refused' as const),
          }
        } catch (err) {
          // Nothing was even queued: a config that will not parse, a template that is not there.
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            status: 'refused' as const,
          }
        }
      }),
    },
    deliveries: {
      list: scoped.deliveries.list.use(requires('mail.deliveries.view')).handler(async ({ input }) => {
        const where = [eq(deliveries.workspaceId, input.workspaceId)]
        if (input.status) where.push(eq(deliveries.status, input.status))
        if (input.cursor) where.push(lt(deliveries.id, input.cursor))
        // Bound to the workspace asked about, so the policy stands behind the `where`.
        const rows = await kernel.database.withWorkspace(input.workspaceId, (tx) =>
          tx
            .select()
            .from(deliveries)
            .where(and(...where))
            .orderBy(desc(deliveries.id))
            .limit(input.limit + 1),
        )
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
    suppressions: {
      list: scoped.suppressions.list.use(requires('mail.settings.manage')).handler(async ({ input }) => {
        const where = [reachableSuppressions(input.workspaceId)]
        if (input.q) where.push(ilike(suppressions.email, `%${escapeLike(input.q.toLowerCase())}%`))
        if (input.cursor) where.push(lt(suppressions.id, input.cursor))
        const rows = await kernel.database.withWorkspace(ALL_WORKSPACES, (tx) =>
          tx
            .select()
            .from(suppressions)
            .where(and(...where))
            .orderBy(desc(suppressions.id))
            .limit(input.limit + 1),
        )
        const items: MailSuppression[] = rows.slice(0, input.limit).map((r) => ({
          id: r.id,
          workspaceId: r.workspaceId as MailSuppression['workspaceId'],
          email: r.email,
          reason: (['bounce', 'complaint', 'manual'].includes(r.reason)
            ? r.reason
            : 'manual') as MailSuppression['reason'],
          source: r.source,
          createdAt: iso(r.createdAt),
        }))
        const nextCursor = rows.length > input.limit ? (items.at(-1)?.id ?? null) : null
        return { items, nextCursor }
      }),
      /**
       * Let the address through again.
       *
       * Recorded rather than done quietly: this is somebody deciding that a provider's refusal was
       * wrong, and the next bounce will put the row straight back. The activity row is best-effort
       * — core being briefly away must not make an administrator think the removal failed and press
       * the button again — so the log line is written first and always.
       */
      remove: scoped.suppressions.remove
        .use(requires('mail.settings.manage'))
        .handler(async ({ input, context }) => {
          const [row] = await kernel.database.withWorkspace(ALL_WORKSPACES, (tx) =>
            tx
              .delete(suppressions)
              .where(and(eq(suppressions.id, input.id), reachableSuppressions(input.workspaceId)))
              .returning(),
          )
          if (!row) throw KernError.notFound('Suppression')
          const actorId = context.principal?.userId ?? null
          const scope = row.workspaceId ? 'workspace' : 'instance'
          kernel.log.info(
            {
              module: MODULE_ID,
              workspaceId: input.workspaceId,
              actorId,
              email: row.email,
              reason: row.reason,
              source: row.source,
              scope,
            },
            'mail suppression removed',
          )
          try {
            await kernel.call('core.activity.record', {
              workspaceId: input.workspaceId,
              module: MODULE_ID,
              object: { module: MODULE_ID, type: 'suppression', id: row.id },
              action: 'suppression.removed',
              actorId,
              changes: [],
              data: { email: row.email, reason: row.reason, source: row.source, scope },
            })
          } catch (err) {
            kernel.log.warn(
              { err: err instanceof Error ? err.message : err },
              'mail suppression removal was not recorded in the activity feed',
            )
          }
          return { ok: true }
        }),
    },
  })
}

/**
 * The suppressions a workspace may see and take away: its own, and the instance-wide ones.
 *
 * The instance-wide rows are the ones that matter most — a bounce on a password reset or a sign-in
 * link belongs to no workspace — so leaving them out would leave the worst case unreachable. Both
 * queries bind `'*'` because a workspace binding cannot see a row with no workspace, which makes
 * this predicate the tenant boundary rather than the policy; `isolation.test.ts` holds it to that.
 */
function reachableSuppressions(workspaceId: string) {
  return or(eq(suppressions.workspaceId, workspaceId), isNull(suppressions.workspaceId))
}

/** `%` and `_` are wildcards in `like`, and an address may contain either. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
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
    version: packageVersion(import.meta.url),
    description: 'Outbound email: per-workspace providers, templates, delivery log and suppressions',
    icon: 'mail',
    core: false,
    defaultHost: 'mail',
    permissions: mailPermissions,
    events: mailEvents,
  }),
  /** Attached so the developer panel can check the router against what was promised. */
  contract: mailContract,
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
