import { session } from '@kernhq/ui'
import { mailPermissions } from '../contract.js'

/**
 * What mail lets somebody do.
 *
 * Derived from the contract rather than re-typed. The app used to keep its own copy of these
 * strings, which type-checks perfectly while being wrong: a mistyped key silently hides a control
 * or offers one the server refuses, and nothing anywhere reports it.
 *
 * Hide what a person may never do; disable — with a reason — what they cannot do right now. The
 * server checks again on every call regardless; this only stops the interface offering a door that
 * will not open.
 */
const key = (suffix: string) => {
  const found = mailPermissions.find((p) => p.key === `mail.${suffix}`)
  if (!found) throw new Error(`mail: no permission declared for mail.${suffix}`)
  return found.key
}

export const MAIL_PERMISSIONS = {
  settingsManage: key('settings.manage'),
  deliveriesView: key('deliveries.view'),
} as const

export type MailPermission = keyof typeof MAIL_PERMISSIONS

export function canMail(permission: MailPermission): boolean {
  return session.can(MAIL_PERMISSIONS[permission])
}
