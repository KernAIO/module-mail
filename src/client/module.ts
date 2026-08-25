import { defineClientModule } from '@kernhq/ui'
import { mailMessageBundles, t } from './i18n.js'
import { MAIL_PERMISSIONS } from './permissions.js'

/**
 * Mail as the shell sees it.
 *
 * No navigation: where a workspace's email comes from is configuration, not a place people visit.
 * The module contributes one settings page and two dashboard cards, and turning mail off in
 * workspace settings removes all three with no conditionals anywhere in the shell.
 *
 * Labels are getters because a module is defined once at import time while the interface language
 * can change afterwards; reading them on render keeps them in the language actually chosen.
 *
 * The settings page's `id` is its URL. The shell mounts a workspace-scope page whose id equals the
 * module id at `/<ws>/settings/mail` — declaring it is the whole wiring, and there is no route file
 * in the app to keep in step with it.
 */
export const mailClientModule = defineClientModule({
  id: 'mail',
  name: 'Mail',
  icon: 'mail',
  messages: mailMessageBundles,

  widgets: [
    {
      id: 'mail.deliveries',
      get title() {
        return t('widget_title')
      },
      get description() {
        return t('widget_desc')
      },
      icon: 'mail',
      permission: MAIL_PERMISSIONS.deliveriesView,
      sizes: ['m', 'l', 'xl'],
      defaultSize: 'l',
      order: 10,
      settings: [
        {
          kind: 'select',
          key: 'status',
          get label() {
            return t('common.setting_status')
          },
          default: null,
          nullable: true,
          get nullLabel() {
            return t('common.any')
          },
          get options() {
            return [
              { value: 'queued', label: t('widget_queued') },
              { value: 'sent', label: t('widget_sent') },
              { value: 'failed', label: t('widget_failed') },
              { value: 'bounced', label: t('widget_bounced') },
            ]
          },
        },
        {
          kind: 'number',
          key: 'limit',
          get label() {
            return t('common.setting_rows')
          },
          default: 8,
          min: 3,
          max: 20,
        },
      ],
      component: () => import('./widgets/DeliveriesWidget.svelte'),
    },
    {
      id: 'mail.stat-failed',
      get title() {
        return t('widget_failed_title')
      },
      get description() {
        return t('widget_failed_desc')
      },
      icon: 'circle-alert',
      permission: MAIL_PERMISSIONS.deliveriesView,
      sizes: ['s'],
      defaultSize: 's',
      compact: true,
      order: 20,
      component: () => import('./widgets/FailedWidget.svelte'),
    },
  ],

  settingsPages: [
    {
      id: 'mail',
      get label() {
        return t('settings_nav')
      },
      icon: 'mail',
      scope: 'workspace',
      permission: MAIL_PERMISSIONS.settingsManage,
      order: 45,
      component: () => import('./settings/MailSettings.svelte'),
    },
  ],
})

export default mailClientModule
