import type { core } from '@kernaio/contracts'

/** Fully resolved message, ready for a provider (attachments already fetched). */
export interface OutgoingMessage {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  replyTo?: string
  subject: string
  text?: string
  html?: string
  headers?: Record<string, string>
  attachments?: Array<{ filename: string; contentType: string; content: Buffer }>
  tags?: string[]
}

export interface SendResult {
  /** provider message id, used to correlate webhook events; null when the provider returns none */
  messageId: string | null
}

export interface MailProvider {
  readonly name: string
  readonly from: string
  send(message: OutgoingMessage): Promise<SendResult>
  /** close pooled connections (SMTP); optional */
  close?(): void
}

export type MailProviderConfig = core.MailProviderConfig

/** Instance-level fallback used when a workspace has no provider configured. */
export interface PlatformMailEnv {
  /** smtp(s)://user:pass@host:port */
  SMTP_URL?: string
  MAIL_FROM?: string
}
