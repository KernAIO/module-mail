import { randomUUID } from 'node:crypto'
import type { Principal } from '@kernhq/contracts'
import { createKernel, type Kernel, type RequestContext } from '@kernhq/kernel'
import { call } from '@orpc/server'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mailModule } from './index.js'
import { addSuppression, loadSuppressed } from './suppressions.js'

/**
 * Reading the blocked list, and taking an address off it.
 *
 * Until these existed a hard bounce was permanent: one full mailbox, one relay answering 550 during
 * a misconfiguration or one press of "report spam" stopped that person receiving password resets,
 * sign-in links and invitations for ever, and the only way back was a SQL statement. The screen
 * showed "failed — all recipients suppressed" and offered nothing.
 *
 * The instance-wide rows are the ones that matter most, because account mail belongs to no
 * workspace, so both procedures reach them — and that is exactly why the removal is recorded.
 */

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://kern:kern@localhost:5432/kern'
const DB_NAME = `kern_mail_suppr_${Date.now().toString(36)}`

let kernel: Kernel
let admin: pg.Client
let router: ReturnType<NonNullable<typeof mailModule.router>>
/** Every `core.activity.record` the module made, so the audit claim is checked rather than assumed. */
const recorded: Array<Record<string, unknown>> = []

const WS = randomUUID()
const ADMIN = randomUUID()

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

const asAdmin = (): RequestContext => ({
  kernel,
  principal: principal(ADMIN, WS),
  requestId: randomUUID(),
  ip: '127.0.0.1',
  headers: {},
})

const listBlocked = (input: { q?: string } = {}) =>
  call(router.suppressions.list, { workspaceId: WS, limit: 50, ...input }, { context: asAdmin() })

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`

  kernel = await createKernel({
    service: 'mail-suppressions-test',
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
    'settings.getIntegration': { handler: async () => null },
    'activity.record': {
      handler: async (input: Record<string, unknown>) => {
        recorded.push(input)
        return { ok: true }
      },
    },
  })
  await kernel.start()
  router = mailModule.router!(kernel)

  await addSuppression(kernel, {
    workspaceId: WS,
    email: 'full-mailbox@example.test',
    reason: 'bounce',
    source: 'postmark',
  })
  await addSuppression(kernel, {
    workspaceId: WS,
    email: 'reported@example.test',
    reason: 'complaint',
    source: 'mailgun',
  })
  // The one that stops a password reset: account mail belongs to no workspace.
  await addSuppression(kernel, {
    workspaceId: null,
    email: 'locked-out@example.test',
    reason: 'bounce',
    source: 'smtp',
  })
}, 180_000)

afterAll(async () => {
  await kernel?.stop().catch(() => undefined)
  await admin?.query(`drop database if exists "${DB_NAME}" with (force)`).catch(() => undefined)
  await admin?.end().catch(() => undefined)
}, 60_000)

describe('reading the blocked list', () => {
  it('shows the workspace’s own rows and the instance-wide ones', async () => {
    const page = await listBlocked()
    expect(page.items.map((s) => s.email).toSorted()).toEqual([
      'full-mailbox@example.test',
      'locked-out@example.test',
      'reported@example.test',
    ])
    // the screen tells the two apart by this, and says so in the confirmation
    expect(page.items.find((s) => s.email === 'locked-out@example.test')?.workspaceId).toBeNull()
    expect(page.items.find((s) => s.email === 'reported@example.test')?.workspaceId).toBe(WS)
  })

  it('keeps the reason and the provider that reported it', async () => {
    const page = await listBlocked()
    const row = page.items.find((s) => s.email === 'reported@example.test')
    expect(row?.reason).toBe('complaint')
    expect(row?.source).toBe('mailgun')
  })

  it('searches by address, and treats a wildcard as a character', async () => {
    expect((await listBlocked({ q: 'reported' })).items.map((s) => s.email)).toEqual([
      'reported@example.test',
    ])
    // `%` is a `like` wildcard: an unescaped one here would match every row instead of none
    expect((await listBlocked({ q: '%' })).items).toEqual([])
    expect((await listBlocked({ q: 'NOBODY' })).items).toEqual([])
  })
})

describe('taking an address off the list', () => {
  it('lets the address through again, and records who did it', async () => {
    const before = await listBlocked({ q: 'full-mailbox' })
    const target = before.items[0]!
    recorded.length = 0

    await call(router.suppressions.remove, { workspaceId: WS, id: target.id }, { context: asAdmin() })

    expect((await listBlocked({ q: 'full-mailbox' })).items).toEqual([])
    // the send path is what actually has to change its mind, so ask it
    expect([...(await loadSuppressed(kernel, WS, ['full-mailbox@example.test']))]).toEqual([])

    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      workspaceId: WS,
      module: 'mail',
      action: 'suppression.removed',
      actorId: ADMIN,
      data: { email: 'full-mailbox@example.test', scope: 'workspace' },
    })
  })

  it('reaches the instance-wide row, which is the one that blocks a password reset', async () => {
    const target = (await listBlocked({ q: 'locked-out' })).items[0]!
    expect(target.workspaceId).toBeNull()
    recorded.length = 0

    await call(router.suppressions.remove, { workspaceId: WS, id: target.id }, { context: asAdmin() })

    expect([...(await loadSuppressed(kernel, null, ['locked-out@example.test']))]).toEqual([])
    expect(recorded[0]).toMatchObject({ data: { scope: 'instance' } })
  })

  it('answers not-found for a row that is already gone, rather than pretending', async () => {
    await expect(
      call(router.suppressions.remove, { workspaceId: WS, id: randomUUID() }, { context: asAdmin() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('removes the row even when core cannot be told', async () => {
    // The activity feed is best-effort: an administrator pressing Remove twice because core was
    // briefly away would be worse than a gap in the feed.
    kernel.broker.register('core', {
      'activity.record': {
        handler: async () => {
          throw new Error('core is away')
        },
      },
    })
    const target = (await listBlocked({ q: 'reported' })).items[0]!
    await expect(
      call(router.suppressions.remove, { workspaceId: WS, id: target.id }, { context: asAdmin() }),
    ).resolves.toEqual({ ok: true })
    expect((await listBlocked()).items).toEqual([])
  })
})
