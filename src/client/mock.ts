import type { WorkspaceId } from '@kernhq/contracts'
import type { MailDelivery } from '../contract.js'
import { SECRET_PLACEHOLDER } from './index.js'

/**
 * The in-memory mail API, for `pnpm dev:mock` and the end-to-end suite.
 *
 * It keeps the one behaviour that is easy to get wrong and impossible to see: a stored secret is
 * never returned, reads replace it with a placeholder, and writing the placeholder back leaves the
 * stored value alone. A mock that echoed the real secret would let a screen that leaks it pass
 * every test.
 */
const DAY = 86_400_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

const SECRET_KEYS = new Set(['pass', 'apiKey', 'secretAccessKey', 'serverToken'])

/** The demo workspace, branded the way the other mocks brand theirs. */
const WORKSPACE = '01920000-0000-7000-8000-000000000010' as string & WorkspaceId

export function createMockMailApi() {
  let config: Record<string, unknown> | null = {
    provider: 'smtp',
    host: 'smtp.example.com',
    port: 587,
    user: 'kern',
    pass: 'hunter2',
    from: 'Northstar <no-reply@northstar.example>',
  }

  const deliveries: MailDelivery[] = [
    {
      id: '0192aa00-0000-7000-8000-00000000d001',
      workspaceId: WORKSPACE,
      to: ['maya@northstar.example'],
      subject: 'You were mentioned in KRN-6',
      provider: 'smtp',
      template: 'mention',
      status: 'sent',
      providerMessageId: '<a1b2@smtp.example.com>',
      error: null,
      tags: ['notification'],
      createdAt: iso(2 * 3600e3),
      updatedAt: iso(2 * 3600e3),
    },
    {
      id: '0192aa00-0000-7000-8000-00000000d002',
      workspaceId: WORKSPACE,
      to: ['tomas@northstar.example'],
      subject: 'Your weekly digest',
      provider: 'smtp',
      template: 'digest',
      status: 'sent',
      providerMessageId: '<c3d4@smtp.example.com>',
      error: null,
      tags: ['digest'],
      createdAt: iso(DAY),
      updatedAt: iso(DAY),
    },
    {
      id: '0192aa00-0000-7000-8000-00000000d003',
      workspaceId: WORKSPACE,
      to: ['left@example.com'],
      subject: 'You have been invited to Northstar',
      provider: 'smtp',
      template: 'invite',
      status: 'bounced',
      providerMessageId: null,
      error: '550 5.1.1 The email account that you tried to reach does not exist',
      tags: ['invite'],
      createdAt: iso(3 * DAY),
      updatedAt: iso(3 * DAY),
    },
    {
      id: '0192aa00-0000-7000-8000-00000000d004',
      workspaceId: WORKSPACE,
      to: ['dan@northstar.example'],
      subject: 'Reset your password',
      provider: 'smtp',
      template: 'password-reset',
      status: 'failed',
      providerMessageId: null,
      error: 'Connection timed out after 30s',
      tags: ['account'],
      createdAt: iso(5 * DAY),
      updatedAt: iso(5 * DAY),
    },
  ]

  /** What a read returns: the shape of the config with every secret masked. */
  const masked = () =>
    config === null
      ? null
      : Object.fromEntries(
          Object.entries(config).map(([k, v]) => [k, SECRET_KEYS.has(k) && v ? SECRET_PLACEHOLDER : v]),
        )

  return {
    settings: {
      get: async () => ({ config: masked() }),
      set: async ({ config: next }: { config: Record<string, unknown> | null }) => {
        if (next === null) {
          config = null
          return { ok: true as const }
        }
        // The placeholder means "leave it alone", which is the whole point of masking on read.
        const merged: Record<string, unknown> = { ...next }
        for (const key of SECRET_KEYS)
          if (merged[key] === SECRET_PLACEHOLDER) merged[key] = config?.[key] ?? ''
        config = merged
        return { ok: true as const }
      },
      test: async ({ to }: { to: string }) =>
        to.endsWith('@example.com') || to.endsWith('.example')
          ? { ok: true as const, error: null }
          : { ok: false as const, error: 'The provider refused the recipient' },
    },
    deliveries: {
      list: async ({ status }: { status?: MailDelivery['status'] }) => ({
        items: deliveries.filter((d) => !status || d.status === status),
        nextCursor: null,
      }),
    },
  }
}
