import { randomUUID } from 'node:crypto'
import type { Principal } from '@kernhq/contracts'
import { createKernel, type Kernel, type RequestContext } from '@kernhq/kernel'
import { call } from '@orpc/server'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mailModule } from './index.js'
import { ALL_WORKSPACES, deliveries } from './schema.js'
import { addSuppression, loadSuppressed } from './suppressions.js'

/**
 * Cross-tenant isolation for the delivery log and the suppression list.
 *
 * Two layers are asserted, because each is a defence the other does not provide: the procedure,
 * which must answer for exactly the workspace it was asked about; and row-level security, which is
 * only observable under a role that cannot bypass it — the development user is a superuser, and
 * superusers bypass every policy. This module's policies also admit the `'*'` binding that its
 * instance-wide paths use, so the probe asserts three bindings: one workspace sees one workspace,
 * `'*'` sees everything, and nothing sees nothing.
 */

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://kern:kern@localhost:5432/kern'
const DB_NAME = `kern_mail_iso_${Date.now().toString(36)}`
const RLS_ROLE = `kern_mail_iso_rls_${Date.now().toString(36)}`

let kernel: Kernel
let admin: pg.Client
let databaseUrl: string
let router: ReturnType<NonNullable<typeof mailModule.router>>

const WS_A = randomUUID()
const WS_B = randomUUID()
const ALICE = randomUUID()
const BOB = randomUUID()

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

const inA = principal(ALICE, WS_A)
const inB = principal(BOB, WS_B)

const context = (who: Principal): RequestContext => ({
  kernel,
  principal: who,
  requestId: randomUUID(),
  ip: '127.0.0.1',
  headers: {},
})

function registerCoreStubs(k: Kernel) {
  k.broker.register('core', {
    'modules.isEnabled': { handler: async () => true },
    'users.principal': {
      handler: async (input: { userId: string }) =>
        principal(input.userId, input.userId === BOB ? WS_B : WS_A),
    },
    'authz.customRolePermissions': { handler: async () => [] },
    'authz.bindings': { handler: async () => [] },
    'settings.getModule': { handler: async () => ({}) },
  })
}

let deliveryA: string
let deliveryB: string
let instanceDelivery: string

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`
  databaseUrl = url.toString()

  kernel = await createKernel({
    service: 'mail-isolation-test',
    modules: [mailModule],
    role: 'api',
    env: {
      DATABASE_URL: databaseUrl,
      KERN_SECRET: 'test-secret-that-is-long-enough-for-kern',
      NODE_ENV: 'test',
      NATS_URL: undefined,
      VALKEY_URL: undefined,
    },
  })
  registerCoreStubs(kernel)
  await kernel.start()
  router = mailModule.router!(kernel)

  // Written the way the send path writes them: bound to every workspace, because an instance-level
  // message has none.
  const rows = await kernel.database.withWorkspace(ALL_WORKSPACES, (tx) =>
    tx
      .insert(deliveries)
      .values([
        {
          workspaceId: WS_A,
          to: ['a@example.test'],
          subject: 'Alpha invoice',
          provider: 'platform',
          status: 'sent',
        },
        {
          workspaceId: WS_B,
          to: ['b@example.test'],
          subject: 'Beta invoice',
          provider: 'platform',
          status: 'sent',
        },
        {
          workspaceId: null,
          to: ['new@example.test'],
          subject: 'Sign in to Kern',
          provider: 'platform',
          status: 'sent',
        },
      ])
      .returning({ id: deliveries.id, workspaceId: deliveries.workspaceId }),
  )
  deliveryA = rows.find((r) => r.workspaceId === WS_A)!.id
  deliveryB = rows.find((r) => r.workspaceId === WS_B)!.id
  instanceDelivery = rows.find((r) => r.workspaceId === null)!.id

  await addSuppression(kernel, { workspaceId: WS_A, email: 'bounced@example.test', reason: 'bounce' })
  await addSuppression(kernel, { workspaceId: null, email: 'complained@example.test', reason: 'complaint' })
}, 180_000)

afterAll(async () => {
  await kernel?.stop().catch(() => undefined)
  await admin?.query(`drop database if exists "${DB_NAME}" with (force)`).catch(() => undefined)
  await admin?.query(`drop role if exists "${RLS_ROLE}"`).catch(() => undefined)
  await admin?.end().catch(() => undefined)
}, 60_000)

describe('the delivery log', () => {
  it('shows a workspace its own deliveries and nobody else’s', async () => {
    const a = await call(router.deliveries.list, { workspaceId: WS_A, limit: 20 }, { context: context(inA) })
    expect(a.items.map((d) => d.id)).toEqual([deliveryA])
    const b = await call(router.deliveries.list, { workspaceId: WS_B, limit: 20 }, { context: context(inB) })
    expect(b.items.map((d) => d.id)).toEqual([deliveryB])
  })

  it('never shows an instance-level delivery to any workspace', async () => {
    // A sign-in link belongs to no workspace and appears in no workspace's log.
    for (const [ws, who] of [
      [WS_A, inA],
      [WS_B, inB],
    ] as const) {
      const list = await call(
        router.deliveries.list,
        { workspaceId: ws, limit: 20 },
        { context: context(who) },
      )
      expect(list.items.map((d) => d.id)).not.toContain(instanceDelivery)
    }
  })

  it('refuses a member of A asking for B’s log', async () => {
    await expect(
      call(router.deliveries.list, { workspaceId: WS_B, limit: 20 }, { context: context(inA) }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|UNAUTHORIZED/) })
  })
})

describe('the suppression list', () => {
  it("applies a workspace's own suppressions and the instance's, never a neighbour's", async () => {
    const forA = await loadSuppressed(kernel, WS_A, [
      'bounced@example.test',
      'complained@example.test',
      'fine@example.test',
    ])
    expect([...forA].sort()).toEqual(['bounced@example.test', 'complained@example.test'])
    const forB = await loadSuppressed(kernel, WS_B, [
      'bounced@example.test',
      'complained@example.test',
      'fine@example.test',
    ])
    expect([...forB]).toEqual(['complained@example.test'])
    const forInstance = await loadSuppressed(kernel, null, [
      'bounced@example.test',
      'complained@example.test',
    ])
    expect([...forInstance]).toEqual(['complained@example.test'])
  })
})

describe('row-level security, under a role that cannot bypass it', () => {
  let plain: pg.Client

  beforeAll(async () => {
    const scratch = new pg.Client({ connectionString: databaseUrl })
    await scratch.connect()
    await scratch.query(`create role "${RLS_ROLE}" login password 'probe' nosuperuser nobypassrls`)
    await scratch.query(`grant usage on schema mod_mail to "${RLS_ROLE}"`)
    await scratch.query(`grant select on all tables in schema mod_mail to "${RLS_ROLE}"`)
    await scratch.end()

    const url = new URL(databaseUrl)
    url.username = RLS_ROLE
    url.password = 'probe'
    plain = new pg.Client({ connectionString: url.toString() })
    await plain.connect()
  }, 60_000)

  afterAll(async () => {
    await plain?.end().catch(() => undefined)
  })

  const count = async (sqlText: string) => {
    const { rows } = await plain.query<{ n: string }>(sqlText)
    return Number(rows[0]?.n ?? -1)
  }

  it('shows a session bound to B none of A, even when the query asks for A by id', async () => {
    await plain.query(`set app.workspace_id = '${WS_B}'`)
    expect(await count(`select count(*) as n from mod_mail.deliveries where id = '${deliveryA}'`)).toBe(0)
    expect(
      await count(`select count(*) as n from mod_mail.suppressions where workspace_id = '${WS_A}'`),
    ).toBe(0)
    // and the binding is what admits B's own rows, so the zero above is a policy, not an empty table
    expect(await count(`select count(*) as n from mod_mail.deliveries where id = '${deliveryB}'`)).toBe(1)
    // an instance-level row belongs to no workspace, so a workspace binding does not see it either
    expect(
      await count(`select count(*) as n from mod_mail.deliveries where id = '${instanceDelivery}'`),
    ).toBe(0)
  })

  it('shows the instance-wide binding everything, which is what the send job and the webhooks use', async () => {
    await plain.query(`set app.workspace_id = '${ALL_WORKSPACES}'`)
    expect(await count(`select count(*) as n from mod_mail.deliveries`)).toBe(3)
    expect(await count(`select count(*) as n from mod_mail.suppressions`)).toBe(2)
  })

  it('shows a session bound to nothing nothing at all', async () => {
    await plain.query(`reset app.workspace_id`)
    expect(await count(`select count(*) as n from mod_mail.deliveries`)).toBe(0)
    expect(await count(`select count(*) as n from mod_mail.suppressions`)).toBe(0)
  })
})
