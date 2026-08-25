export { MODULE_ID, SECRET_PLACEHOLDER } from '../contract.js'
export { createMailClient, type MailApi } from './api.js'
export { __setMailApi, getMailApi } from './api-instance.js'
export { type MailMessageKey, mailMessageBundles, t } from './i18n.js'
export { mailClientModule, mailClientModule as default } from './module.js'
export { canMail, MAIL_PERMISSIONS, type MailPermission } from './permissions.js'

/**
 * Mail's client half: the typed API client, its own strings, its permissions, and the client module
 * the shell registers.
 *
 * The screens live here too — `settings/MailSettings.svelte` and the two dashboard cards — rather
 * than in the app. That is what makes this a module rather than a server half plus a hand-written
 * page somebody has to remember to keep in step: the shell mounts whatever the manifest declares,
 * and deleting this package removes the feature completely.
 */
