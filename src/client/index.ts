import { defineClientModule } from '@kernalo/kernel/client'
import { MODULE_ID } from '../contract.js'

/**
 * Mail's client surface. The module has no navigation of its own — outbound email is configuration,
 * not a place people visit — so it contributes a workspace settings page where an admin chooses the
 * provider and sends a test message.
 *
 * The settings component is still to be written; the entry is registered so the module appears in
 * the settings navigation as soon as it lands.
 */
export const mailClient = defineClientModule({
  id: MODULE_ID,
  name: 'Mail',
  icon: 'mail',
  settingsPages: [
    {
      id: 'mail',
      label: 'Email',
      icon: 'mail',
      scope: 'workspace',
      permission: 'mail.settings.manage',
      order: 40,
      component: () => import('./MailSettings.svelte'),
    },
  ],
})

export default mailClient
