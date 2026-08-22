import nodemailer, { type Transporter } from 'nodemailer'
import type { MailProvider, OutgoingMessage, SendResult } from './types.js'

export interface SmtpOptions {
  /** smtp(s)://user:pass@host:port — overrides the individual fields */
  url?: string
  host?: string
  port?: number
  secure?: boolean
  user?: string
  pass?: string
  from: string
}

export function smtpProvider(opts: SmtpOptions): MailProvider {
  const transport: Transporter = opts.url
    ? nodemailer.createTransport(opts.url)
    : nodemailer.createTransport({
        host: opts.host,
        port: opts.port,
        secure: opts.secure ?? true,
        auth: opts.user ? { user: opts.user, pass: opts.pass ?? '' } : undefined,
      })
  return {
    name: 'smtp',
    from: opts.from,
    async send(m: OutgoingMessage): Promise<SendResult> {
      const info = await transport.sendMail({
        from: m.from,
        to: m.to,
        cc: m.cc,
        bcc: m.bcc,
        replyTo: m.replyTo,
        subject: m.subject,
        text: m.text,
        html: m.html,
        headers: m.headers,
        attachments: m.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.content,
        })),
      })
      return { messageId: info.messageId ?? null }
    },
    close: () => transport.close(),
  }
}
