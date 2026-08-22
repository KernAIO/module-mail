import type { MailProvider, OutgoingMessage, SendResult } from './types.js'

export interface PostmarkOptions {
  serverToken: string
  from: string
}

export function postmarkProvider(opts: PostmarkOptions): MailProvider {
  return {
    name: 'postmark',
    from: opts.from,
    async send(m: OutgoingMessage): Promise<SendResult> {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-postmark-server-token': opts.serverToken,
        },
        body: JSON.stringify({
          From: m.from,
          To: m.to.join(','),
          Cc: m.cc?.join(','),
          Bcc: m.bcc?.join(','),
          ReplyTo: m.replyTo,
          Subject: m.subject,
          TextBody: m.text,
          HtmlBody: m.html,
          Tag: m.tags?.[0],
          Headers: Object.entries(m.headers ?? {}).map(([Name, Value]) => ({ Name, Value })),
          Attachments: m.attachments?.map((a) => ({
            Name: a.filename,
            ContentType: a.contentType,
            Content: a.content.toString('base64'),
          })),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { MessageID?: string; Message?: string }
      if (!res.ok) throw new Error(`postmark ${res.status}: ${body.Message ?? 'send failed'}`)
      return { messageId: body.MessageID ?? null }
    },
  }
}
