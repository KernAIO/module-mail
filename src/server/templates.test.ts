import type { Kernel } from '@kernhq/kernel'
import { describe, expect, it } from 'vitest'
import { buildMessage } from './send.js'
import { renderPlainText, renderTemplate, templateNames } from './templates.js'

/**
 * The shipped templates, and the branding of a message that names none of them.
 *
 * Both halves were untested and one of them was unreachable: five MJML templates shipped in the
 * package while every email the platform actually sends was built by its caller, so nothing here
 * ever compiled them. A template that does not compile fails inside the send job, where the only
 * evidence is a failed delivery row.
 */

/**
 * Every field any template interpolates. A new template that needs something else fails this file
 * rather than a customer's send job — which is the point of holding the sample in one place.
 */
const SAMPLE = {
  acceptUrl: 'https://kern.example/invite/abc123',
  email: 'maya@northstar.example',
  inboxUrl: 'https://kern.example/inbox',
  instanceName: 'Northstar',
  inviterName: 'Tomas Berg',
  items: [
    {
      title: 'You were mentioned in KRN-6',
      body: 'Could you take a look?',
      url: 'https://kern.example/KRN-6',
    },
    { title: 'Release 2.1 shipped', body: '', url: 'https://kern.example/releases/2-1' },
  ],
  name: 'Maya',
  periodLabel: 'daily',
  provider: 'smtp',
  url: 'https://kern.example/auth/magic/abc123',
  workspaceName: 'Northstar',
}

describe('the shipped templates', () => {
  it('offers the five the docs promise plus the test message, and no layout file', () => {
    expect(templateNames()).toEqual([
      'invitation',
      'magic-link',
      'notification-digest',
      'reset-password',
      'test',
      'verify-email',
    ])
  })

  for (const name of templateNames()) {
    it(`compiles ${name} to HTML, text and a subject line`, async () => {
      const rendered = await renderTemplate(name, SAMPLE, { instanceName: 'Northstar' })
      expect(rendered.html).toContain('<html')
      // the shared paper layout, not a bare fragment
      expect(rendered.html.toLowerCase()).toContain('#e9e6dd')
      expect(rendered.subject.trim().length).toBeGreaterThan(0)
      expect(rendered.text.trim().length).toBeGreaterThan(0)
      // an unreplaced `<%=` means the sample above is missing a field this template needs
      expect(rendered.html).not.toContain('<%')
      expect(rendered.text).not.toContain('<%')
      expect(rendered.subject).not.toContain('<%')
      expect(rendered.html).not.toContain('undefined')
    })
  }

  it('refuses a name that is not a template, including a path', async () => {
    await expect(renderTemplate('nope', {})).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(renderTemplate('../_layout', {})).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('plain text in the shared layout', () => {
  it('brands the message and keeps every paragraph', async () => {
    const html = await renderPlainText('Hi Maya,\n\nWhile you were away:\n• KRN-6\n\nSee you.', {
      instanceName: 'Northstar',
    })
    expect(html).toContain('Northstar')
    expect(html).toContain('While you were away:')
    // a single newline inside a paragraph is a line break, not a lost line
    expect(html).toContain('<br />')
    expect(html).toContain('See you.')
  })

  it('turns a bare link into one, without trailing punctuation', async () => {
    const html = await renderPlainText('Open your inbox: https://kern.example/inbox.')
    expect(html).toContain('href="https://kern.example/inbox"')
    expect(html).not.toContain('href="https://kern.example/inbox."')
  })

  it('escapes the caller’s text before it linkifies it', async () => {
    const html = await renderPlainText('<script>alert(1)</script> & "quotes"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('what the send path does with a message', () => {
  // `buildMessage` only reaches the kernel to fetch attachments, and none of these have any.
  const noKernel = null as unknown as Kernel
  const base = { to: ['maya@northstar.example'], subject: 'Hello' }

  it('brands a text-only message, because that is what core’s digest sends', async () => {
    const built = await buildMessage(noKernel, { ...base, text: 'Line one.' }, 'Kern <no-reply@kern.test>')
    expect(built.text).toBe('Line one.')
    expect(built.html).toContain('<html')
    expect(built.html).toContain('Line one.')
  })

  it('leaves a caller’s own HTML exactly as it arrived', async () => {
    const html = '<p>mine</p>'
    const built = await buildMessage(noKernel, { ...base, text: 'mine', html }, 'Kern <no-reply@kern.test>')
    expect(built.html).toBe(html)
  })

  it('renders a named template and takes its text', async () => {
    const built = await buildMessage(
      noKernel,
      { ...base, subject: '', template: { name: 'magic-link', data: SAMPLE } },
      'Kern <no-reply@kern.test>',
    )
    expect(built.html).toContain(SAMPLE.url)
    expect(built.text).toContain(SAMPLE.url)
    // an empty subject takes the template's own line rather than going out blank
    expect(built.subject).toContain('Sign in to')
  })

  it('refuses a message with no body at all', async () => {
    await expect(buildMessage(noKernel, base, 'Kern <no-reply@kern.test>')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })
})
