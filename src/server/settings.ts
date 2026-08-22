import { core } from '@kernaio/contracts'
import { KernError, SECRET_FIELD_NAMES } from '@kernaio/kernel'
import { SECRET_PLACEHOLDER } from '../contract.js'

/** Replace secret fields with a placeholder before returning config to clients. */
export function maskConfig(config: core.MailProviderConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config }
  for (const key of SECRET_FIELD_NAMES)
    if (typeof out[key] === 'string' && out[key] !== '') out[key] = SECRET_PLACEHOLDER
  return out
}

/**
 * Merge a client-submitted config with the stored one: placeholder values keep
 * the stored secret. Validates the result against the contracts schema.
 */
export function unmaskConfig(
  next: Record<string, unknown>,
  prev: core.MailProviderConfig | null,
): core.MailProviderConfig {
  const merged: Record<string, unknown> = { ...next }
  for (const key of SECRET_FIELD_NAMES) {
    if (merged[key] !== SECRET_PLACEHOLDER) continue
    const prevValue =
      prev && (prev as Record<string, unknown>).provider === merged.provider
        ? (prev as Record<string, unknown>)[key]
        : undefined
    if (typeof prevValue !== 'string')
      throw new KernError('BAD_REQUEST', `Missing value for secret field "${key}"`)
    merged[key] = prevValue
  }
  const parsed = core.MailProviderConfig.safeParse(merged)
  if (!parsed.success)
    throw new KernError('VALIDATION', 'Invalid mail provider config', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    })
  return parsed.data
}
