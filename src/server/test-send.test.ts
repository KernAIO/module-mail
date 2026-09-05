import { randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import type { Principal } from '@kernhq/contracts'
import { createKernel, type Kernel, type RequestContext } from '@kernhq/kernel'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mailModule } from './index.js'
import { ALL_WORKSPACES, deliveries } from './schema.js'
import { addSuppression } from './suppressions.js'

/**
 * "Send test" on Settings → Email, which is the one control whose entire job is to prove that mail
 * works.
 *
 * It used to enqueue a job and answer `ok: true` — for credentials that could not connect, for a
 * recipient on the blocked list, for an instance with no provider at all. So this asserts the only
 * thing that matters: that the message reached a server before the handler answered, and that a
 * refusal comes back in the provider's own words with the delivery row saying the same thing.
 *
 * The SMTP server is a stub rather than a mock of our own code: nodemailer is the part most likely
 * to be held wrong, and a test that replaces it proves nothing about it.
 */

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://kern:kern@localhost:5432/kern'
const DB_NAME = `kern_mail_test_send_${Date.now().toString(36)}`

let kernel: Kernel
let admin: pg.Client
let router: ReturnType<NonNullable<typeof mailModule.router>>
let smtp: StubSmtp
let config: Record<string, unknown> | null = null
/** When set, `core.settings.getIntegration` fails with this message — core briefly unreachable. */
let integrationFailure: string | null = null

const WS = randomUUID()
const ADMIN = randomUUID()

/** A minimal SMTP conversation: enough for nodemailer, and it keeps what it was given. */
interface StubSmtp {
  port: number
  received: string[]
  close(): Promise<void>
}

async function startStubSmtp(): Promise<StubSmtp> {
  const received: string[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    let inData = false
    let body = ''
    socket.write('220 stub ESMTP\r\n')
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      if (inData) {
        body += text
        if (body.includes('\r\n.\r\n')) {
          received.push(body)
          body = ''
          inData = false
          socket.write('250 2.0.0 Ok: queued as STUB1\r\n')
        }
        return
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        const verb = line.slice(0, 4).toUpperCase()
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250-stub\r\n250 8BITMIME\r\n')
        else if (verb === 'DATA') {
          inData = true
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (verb === 'QUIT') {
          socket.write('221 Bye\r\n')
          socket.end()
        } else socket.write('250 Ok\r\n')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    port,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

const principal = (userId: string, workspaceId: string): Principal =>
  ({
    kind: 'user',
    userId,
    email: `${userId}@example.test`,
    name: userId.slice(0, 8),
    locale: 'en',
    instanceAdmin: false,
    service: null,
    memberships: [{ workspaceId, role: 'admin', roleIds: [], groupIds: [], status: 'active' }],
    permissionVersion: 0,
  }) as Principal

const context = (who: Principal): RequestContext => ({
  kernel,
  principal: who,
  requestId: randomUUID(),
  ip: '127.0.0.1',
  headers: {},
})

const asAdmin = () => context(principal(ADMIN, WS))

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`

  smtp = await startStubSmtp()

  kernel = await createKernel({
    service: 'mail-test-send-test',
    modules: [mailModule],
    role: 'api',
    env: {
      DATABASE_URL: url.toString(),
      KERN_SECRET: 'test-secret-that-is-long-enough-for-kern',
      NODE_ENV: 'test',
      NATS_URL: undefined,
      VALKEY_URL: undefined,
    },
  })
  kernel.broker.register('core', {
    'modules.isEnabled': { handler: async () => true },
    'users.principal': { handler: async (input: { userId: string }) => principal(input.userId, WS) },
    'authz.customRolePermissions': { handler: async () => [] },
    'authz.bindings': { handler: async () => [] },
    'settings.getModule': { handler: async () => ({}) },
    'settings.getIntegration': {
      handler: async () => {
        if (integrationFailure) throw new Error(integrationFailure)
        return config
      },
    },
  })
  await kernel.start()
  router = mailModule.router!(kernel)
}, 180_000)

afterAll(async () => {
  await kernel?.stop().catch(() => undefined)
  await smtp?.close().catch(() => undefined)
  await admin?.query(`drop database if exists "${DB_NAME}" with (force)`).catch(() => undefined)
  await admin?.end().catch(() => undefined)
}, 60_000)

const logged = async () =>
  kernel.database.withWorkspace(ALL_WORKSPACES, (tx) =>
    tx.select().from(deliveries).where(eq(deliveries.workspaceId, WS)),
  )

describe('the test send', () => {
  it('sends before it answers, and says the message arrived', async () => {
    config = { provider: 'smtp', host: '127.0.0.1', port: smtp.port, secure: false, from: 'Kern <k@t.test>' }
    const before = smtp.received.length

    const result = await call(
      router.settings.test,
      { workspaceId: WS, to: 'someone@example.test' },
      { context: asAdmin() },
    )

    expect(result).toEqual({ ok: true, error: null })
    // the whole point: the provider was used inside the handler, not by a job afterwards
    expect(smtp.received.length).toBe(before + 1)
    const body = smtp.received.at(-1) ?? ''
    expect(body).toContain('someone@example.test')
    // and it is the branded template, not a bare line of text
    expect(body.toLowerCase()).toContain('mail is working')

    const rows = await logged()
    expect(rows.map((r) => r.status)).toEqual(['sent'])
    expect(rows[0]?.template).toBe('test')
  })

  it('reports the provider’s refusal instead of a green toast', async () => {
    // A port nothing listens on is the shape of every mistyped host and closed firewall.
    config = { provider: 'smtp', host: '127.0.0.1', port: 1, secure: false, from: 'Kern <k@t.test>' }
    const before = smtp.received.length

    const result = await call(
      router.settings.test,
      { workspaceId: WS, to: 'refused@example.test' },
      { context: asAdmin() },
    )

    expect(result.ok).toBe(false)
    expect(result.status).toBe('refused')
    expect(result.error).toBeTruthy()
    expect(smtp.received.length).toBe(before)

    // and the delivery log agrees, rather than sitting on `queued` for ever
    const row = (await logged()).find((r) => r.to.includes('refused@example.test'))
    expect(row?.status).toBe('failed')
    expect(row?.error).toBe(result.error)
  })

  it('names the blocked list when that is what stopped it', async () => {
    config = { provider: 'smtp', host: '127.0.0.1', port: smtp.port, secure: false, from: 'Kern <k@t.test>' }
    await addSuppression(kernel, { workspaceId: WS, email: 'blocked@example.test', reason: 'bounce' })
    const before = smtp.received.length

    const result = await call(
      router.settings.test,
      { workspaceId: WS, to: 'blocked@example.test' },
      { context: asAdmin() },
    )

    expect(result.ok).toBe(false)
    // not `refused`: nothing was asked of the provider, and the fix is on this screen
    expect(result.status).toBe('suppressed')
    expect(smtp.received.length).toBe(before)
  })

  it('names the missing provider on an instance that has none, once', async () => {
    // The state every self-hosted install starts in. It has to reach the administrator as an
    // answer, and the delivery row has to say so rather than sitting on `queued`.
    config = null
    const smtpUrl = process.env.SMTP_URL
    delete process.env.SMTP_URL
    const failed: string[] = []
    const off = await kernel.events.subscribe('mail.delivery.failed', (e) => {
      failed.push(String((e.payload as { error?: unknown }).error ?? ''))
    })
    try {
      const result = await call(
        router.settings.test,
        { workspaceId: WS, to: 'nowhere@example.test' },
        { context: asAdmin() },
      )
      expect(result.ok).toBe(false)
      expect(result.status).toBe('refused')
      expect(result.error).toContain('No mail provider configured')

      const row = (await logged()).find((r) => r.to.includes('nowhere@example.test'))
      expect(row?.status).toBe('failed')
      // One attempt, one event: the test send does not go through the queue, so the `send` job's
      // five retries — which would emit this five more times — are not in play here.
      expect(failed).toHaveLength(1)
      expect(failed[0]).toContain('No mail provider configured')
    } finally {
      off()
      if (smtpUrl !== undefined) process.env.SMTP_URL = smtpUrl
    }
  })

  it('reports a failure when core cannot be reached, rather than throwing', async () => {
    // Reading the workspace's provider config is a call to core, and core is a different service:
    // a restart, a rolling deploy or a dropped connection makes it fail for a few seconds. Every
    // failure this handler can meet has to arrive on the screen the same way, because the control's
    // entire job is to tell an administrator the truth about whether mail works.
    config = { provider: 'smtp', host: '127.0.0.1', port: smtp.port, secure: false, from: 'Kern <k@t.test>' }
    integrationFailure = 'core is unreachable'
    try {
      const result = await call(
        router.settings.test,
        { workspaceId: WS, to: 'unreachable@example.test' },
        { context: asAdmin() },
      )
      expect(result.ok).toBe(false)
      expect(result.status).toBe('refused')
      expect(result.error).toBeTruthy()
    } finally {
      integrationFailure = null
    }
  })
})
