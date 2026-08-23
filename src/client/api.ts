import { createModuleClient, type KernClientOptions } from '@kernhq/sdk'
import type { ContractRouterClient } from '@orpc/contract'
import type { MailContract } from '../contract.js'

/**
 * Typed oRPC client for `/api/mail` (see `../contract`).
 *
 * Mail runs as its own service because it holds provider connections and a delivery queue, but its
 * REST surface is reached like any other module's: same origin, same session cookie, the reverse
 * proxy routes the prefix.
 */
export type MailApi = ContractRouterClient<MailContract>

export function createMailClient(opts: KernClientOptions): MailApi {
  return createModuleClient<MailApi>(opts, 'mail')
}
