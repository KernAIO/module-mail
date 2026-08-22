import { KernError } from '@kernalo/kernel'
import { mailgunProvider } from './mailgun.js'
import { postmarkProvider } from './postmark.js'
import { resendProvider } from './resend.js'
import { sesProvider } from './ses.js'
import { smtpProvider } from './smtp.js'
import type { MailProvider, MailProviderConfig, PlatformMailEnv } from './types.js'

export * from './mailgun.js'
export * from './postmark.js'
export * from './resend.js'
export * from './ses.js'
export * from './smtp.js'
export * from './types.js'

/**
 * Build the provider for a workspace config, falling back to the platform SMTP
 * (SMTP_URL + MAIL_FROM) when the config is null or `provider: 'platform'`.
 */
export function providerFor(
  config: MailProviderConfig | null,
  env: PlatformMailEnv = process.env,
): MailProvider {
  if (!config || config.provider === 'platform') {
    if (!env.SMTP_URL)
      throw new KernError('UNAVAILABLE', 'No mail provider configured and no platform SMTP_URL set')
    return smtpProvider({ url: env.SMTP_URL, from: env.MAIL_FROM ?? 'kern@localhost' })
  }
  switch (config.provider) {
    case 'smtp':
      return smtpProvider(config)
    case 'mailgun':
      return mailgunProvider(config)
    case 'ses':
      return sesProvider(config)
    case 'postmark':
      return postmarkProvider(config)
    case 'resend':
      return resendProvider(config)
  }
}
