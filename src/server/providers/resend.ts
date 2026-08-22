import type { MailProvider, OutgoingMessage, SendResult } from './types.js'

export interface ResendOptions {
  apiKey: string
  from: string
}

export function resendProvider(opts: ResendOptions): MailProvider {
  return {
    name: 'resend',
    from: opts.from,
    async send(m: OutgoingMessage): Promise<SendResult> {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          from: m.from,
          to: m.to,
          cc: m.cc,
          bcc: m.bcc,
          reply_to: m.replyTo,
          subject: m.subject,
          text: m.text,
          html: m.html,
          headers: m.headers,
          attachments: m.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content.toString('base64'),
            content_type: a.contentType,
          })),
          tags: m.tags?.map((t) => ({ name: t, value: 'true' })),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
      if (!res.ok) throw new Error(`resend ${res.status}: ${body.message ?? 'send failed'}`)
      return { messageId: body.id ?? null }
    },
  }
}
