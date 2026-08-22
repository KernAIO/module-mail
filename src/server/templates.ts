import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KernError } from '@kernalo/kernel'
import { Eta } from 'eta'
import mjml2html from 'mjml'

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '../../templates')

/** HTML fragments: interpolations are HTML-escaped. Text/subject: raw. */
const etaHtml = new Eta({ autoEscape: true, autoTrim: false })
const etaText = new Eta({ autoEscape: false, autoTrim: false })

export interface RenderedTemplate {
  subject: string
  html: string
  text: string
}

export interface RenderOptions {
  /** shown in the header and footer of every email */
  instanceName?: string
  footer?: string
}

const files = new Map<string, string>()
function file(name: string): string {
  let content = files.get(name)
  if (content === undefined) {
    content = readFileSync(join(templatesDir, name), 'utf8')
    files.set(name, content)
  }
  return content
}

export function templateNames(): string[] {
  return readdirSync(templatesDir)
    .filter((f) => f.endsWith('.mjml') && !f.startsWith('_'))
    .map((f) => f.replace(/\.mjml$/, ''))
    .sort()
}

export function hasTemplate(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name) && templateNames().includes(name)
}

/**
 * Render a named template: eta interpolation into the MJML body fragment,
 * wrapped in the shared paper layout, compiled to email HTML, plus the plain-text
 * fallback and subject line.
 */
export async function renderTemplate(
  name: string,
  data: Record<string, unknown>,
  opts: RenderOptions = {},
): Promise<RenderedTemplate> {
  if (!hasTemplate(name)) throw new KernError('NOT_FOUND', `Unknown mail template: ${name}`)
  const it = { instanceName: opts.instanceName ?? 'Kern', ...data }
  const body = etaHtml.renderString(file(`${name}.mjml`), it)
  const footer =
    opts.footer ?? `Sent by ${escapeHtml(String(it.instanceName))} · an open-source Kern instance`
  const mjml = etaText.renderString(file('_layout.mjml'), {
    __instanceName: escapeHtml(String(it.instanceName)),
    __body: body,
    __footer: footer,
  })
  const { html, errors } = await mjml2html(mjml, { validationLevel: 'soft' })
  if (!html) throw new KernError('INTERNAL', `Template ${name} failed to compile: ${errors[0]?.message}`)
  const text = etaText.renderString(file(`${name}.txt`), it).trim()
  const subject = etaText.renderString(file(`${name}.subject.txt`), it).trim()
  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
