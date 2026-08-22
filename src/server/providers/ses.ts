import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import type { MailProvider, OutgoingMessage, SendResult } from './types.js'

export interface SesOptions {
  accessKeyId: string
  secretAccessKey: string
  region: string
  from: string
}

export function sesProvider(opts: SesOptions): MailProvider {
  const client = new SESv2Client({
    region: opts.region,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
  })
  return {
    name: 'ses',
    from: opts.from,
    async send(m: OutgoingMessage): Promise<SendResult> {
      const destination = { ToAddresses: m.to, CcAddresses: m.cc, BccAddresses: m.bcc }
      // attachments and custom headers need a raw MIME message; plain messages use Simple content
      const needsRaw = (m.attachments?.length ?? 0) > 0 || Object.keys(m.headers ?? {}).length > 0
      const command = needsRaw
        ? new SendEmailCommand({
            FromEmailAddress: m.from,
            Destination: destination,
            Content: { Raw: { Data: await composeRaw(m) } },
          })
        : new SendEmailCommand({
            FromEmailAddress: m.from,
            Destination: destination,
            ReplyToAddresses: m.replyTo ? [m.replyTo] : undefined,
            Content: {
              Simple: {
                Subject: { Data: m.subject, Charset: 'UTF-8' },
                Body: {
                  Text: m.text ? { Data: m.text, Charset: 'UTF-8' } : undefined,
                  Html: m.html ? { Data: m.html, Charset: 'UTF-8' } : undefined,
                },
              },
            },
          })
      const res = await client.send(command)
      return { messageId: res.MessageId ?? null }
    },
  }
}

async function composeRaw(m: OutgoingMessage): Promise<Uint8Array> {
  const composer = new MailComposer({
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
  return composer.compile().build()
}
