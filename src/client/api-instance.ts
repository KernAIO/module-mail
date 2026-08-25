import { getHost } from '@kernhq/ui'
import { createMailClient, type MailApi } from './api.js'
import { createMockMailApi } from './mock.js'

/**
 * The mail API client.
 *
 * Mail runs in its own service because it holds provider connections and a delivery queue, but its
 * REST surface is reached like any other module's: `/api/mail`, same origin, same session cookie.
 * The dev server proxies the prefix to 4200 and Caddy does the same in production.
 *
 * The base URL comes from the shell, not from an env var read here: same-origin in every real
 * deployment, so this module never needs to know that mail listens on 4200.
 *
 * The shell also decides whether it is running against the in-memory implementation, which
 * satisfies the same contract types — so the settings screen has no second code path for demos and
 * end-to-end tests.
 */
export type { MailApi }

let cached: MailApi | null = null

export function getMailApi(): MailApi {
  if (cached) return cached
  const host = getHost()
  cached = host.isMock
    ? (createMockMailApi() as unknown as MailApi)
    : createMailClient({ baseUrl: host.apiBaseUrl })
  return cached
}

/** Test seam: lets tests install a fake without touching module state elsewhere. */
export function __setMailApi(api: MailApi | null) {
  cached = api
}
