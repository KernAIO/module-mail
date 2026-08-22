import type { MailProvider, OutgoingMessage, SendResult } from './types.js'

export interface MailgunOptions {
  apiKey: string
  domain: string
  region?: 'us' | 'eu'
  from: string
}

export function mailgunProvider(opts: MailgunOptions): MailProvider {
  const base = opts.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
  const auth = `Basic ${Buffer.from(`api:${opts.apiKey}`).toString('base64')}`
  return {
    name: 'mailgun',
    from: opts.from,
    async send(m: OutgoingMessage): Promise<SendResult> {
      const form = new FormData()
      form.set('from', m.from)
      for (const to of m.to) form.append('to', to)
      for (const cc of m.cc ?? []) form.append('cc', cc)
      for (const bcc of m.bcc ?? []) form.append('bcc', bcc)
      form.set('subject', m.subject)
      if (m.text) form.set('text', m.text)
      if (m.html) form.set('html', m.html)
      if (m.replyTo) form.set('h:Reply-To', m.replyTo)
      for (const [k, v] of Object.entries(m.headers ?? {})) form.set(`h:${k}`, v)
      for (const tag of m.tags ?? []) form.append('o:tag', tag)
      for (const a of m.attachments ?? [])
        form.append('attachment', new Blob([new Uint8Array(a.content)], { type: a.contentType }), a.filename)
      const res = await fetch(`${base}/v3/${opts.domain}/messages`, {
        method: 'POST',
        headers: { authorization: auth },
        body: form,
      })
      if (!res.ok) throw new Error(`mailgun ${res.status}: ${(await res.text()).slice(0, 500)}`)
      const body = (await res.json()) as { id?: string }
      // mailgun wraps the message id in angle brackets
      return { messageId: body.id?.replace(/^<|>$/g, '') ?? null }
    },
  }
}
