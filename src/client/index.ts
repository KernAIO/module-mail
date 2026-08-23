export { MODULE_ID, SECRET_PLACEHOLDER } from '../contract.js'
export { createMailClient, type MailApi } from './api.js'

/**
 * Mail's client surface is a typed API client and nothing else.
 *
 * There is no client module here: the app composes its own (`registry.ts` registers modules defined
 * in `app/src/lib/modules/*/client.ts`), because navigation labels have to go through the app's
 * message catalogue and its screens are app routes. A `defineClientModule` in this package would
 * never be registered and its `component` never rendered.
 */
