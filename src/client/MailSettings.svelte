<script lang="ts">
import { SECRET_PLACEHOLDER } from '@kernhq/module-mail/contract'

/**
 * Workspace email settings.
 *
 * A workspace can send through its own provider; without one it falls back to the instance's SMTP
 * configuration, so a fresh self-hosted install already delivers invitations and password resets.
 *
 * Stored secrets are never returned by the API — reads replace them with a placeholder, and sending
 * the placeholder back leaves the stored value untouched. That is why the fields below start out
 * showing the placeholder rather than empty when a provider is already configured.
 */
interface MailApi {
  settings: {
    get(input: { workspaceId: string }): Promise<{ config: Record<string, unknown> | null }>
    set(input: { workspaceId: string; config: Record<string, unknown> | null }): Promise<{ ok: boolean }>
    test(input: { workspaceId: string; to: string }): Promise<{ ok: boolean; error: string | null }>
  }
}

interface Props {
  workspaceId: string
  /** the caller passes a client bound to /api/mail */
  api: MailApi
  /** address the test message goes to (defaults to the signed-in user) */
  testAddress?: string
}
let { workspaceId, api, testAddress = '' }: Props = $props()

type Provider = 'platform' | 'smtp' | 'mailgun' | 'ses' | 'postmark' | 'resend'

const FIELDS: Record<Provider, Array<{ key: string; label: string; type?: string; hint?: string }>> = {
  platform: [],
  smtp: [
    { key: 'host', label: 'Host' },
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'user', label: 'Username' },
    { key: 'pass', label: 'Password', type: 'password' },
    { key: 'from', label: 'From address', hint: 'Kern <no-reply@example.com>' },
  ],
  mailgun: [
    { key: 'apiKey', label: 'API key', type: 'password' },
    { key: 'domain', label: 'Domain' },
    { key: 'region', label: 'Region', hint: 'us or eu' },
    { key: 'from', label: 'From address' },
  ],
  ses: [
    { key: 'accessKeyId', label: 'Access key ID' },
    { key: 'secretAccessKey', label: 'Secret access key', type: 'password' },
    { key: 'region', label: 'Region' },
    { key: 'from', label: 'From address' },
  ],
  postmark: [
    { key: 'serverToken', label: 'Server token', type: 'password' },
    { key: 'from', label: 'From address' },
  ],
  resend: [
    { key: 'apiKey', label: 'API key', type: 'password' },
    { key: 'from', label: 'From address' },
  ],
}

const PROVIDER_LABELS: Record<Provider, string> = {
  platform: 'Use the instance default',
  smtp: 'SMTP',
  mailgun: 'Mailgun',
  ses: 'Amazon SES',
  postmark: 'Postmark',
  resend: 'Resend',
}

let provider = $state<Provider>('platform')
let values = $state<Record<string, string>>({})
let loading = $state(true)
let saving = $state(false)
let testing = $state(false)
let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null)
let recipient = $state(testAddress)

$effect(() => {
  void (async () => {
    const { config } = await api.settings.get({ workspaceId })
    if (config && typeof config.provider === 'string') {
      provider = config.provider as Provider
      values = Object.fromEntries(
        Object.entries(config)
          .filter(([k]) => k !== 'provider')
          .map(([k, v]) => [k, String(v ?? '')]),
      )
    }
    loading = false
  })()
})

const fields = $derived(FIELDS[provider])

async function save(event: SubmitEvent) {
  event.preventDefault()
  saving = true
  message = null
  try {
    const config =
      provider === 'platform'
        ? null
        : { provider, ...Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ''])) }
    await api.settings.set({ workspaceId, config })
    message = { kind: 'ok', text: 'Email settings saved' }
  } catch (err) {
    message = { kind: 'error', text: err instanceof Error ? err.message : 'Could not save settings' }
  } finally {
    saving = false
  }
}

async function sendTest() {
  if (!recipient) return
  testing = true
  message = null
  try {
    const result = await api.settings.test({ workspaceId, to: recipient })
    message = result.ok
      ? { kind: 'ok', text: `Test message queued for ${recipient}` }
      : { kind: 'error', text: result.error ?? 'The provider rejected the message' }
  } catch (err) {
    message = { kind: 'error', text: err instanceof Error ? err.message : 'Could not send the test' }
  } finally {
    testing = false
  }
}
</script>

<section class="grid gap-4">
  <header>
    <h2 class="text-[15px] font-semibold text-[var(--kern-ink-900)]">Email</h2>
    <p class="mt-1 text-[12.5px] leading-relaxed text-[var(--kern-ink-500)]">
      Choose how this workspace sends email. Without a provider it uses the instance default.
    </p>
  </header>

  {#if loading}
    <p class="text-[13px] text-[var(--kern-ink-400)]">Loading…</p>
  {:else}
    <form class="grid gap-4" onsubmit={save}>
      <label class="grid gap-1.5">
        <span class="text-[12.5px] font-medium text-[var(--kern-ink-700)]">Provider</span>
        <select
          bind:value={provider}
          class="h-[34px] rounded-[9px] border border-[var(--kern-border)] bg-[var(--kern-surface-input)] px-2.5 text-[13px] text-[var(--kern-ink-900)]"
        >
          {#each Object.entries(PROVIDER_LABELS) as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
      </label>

      {#each fields as field (field.key)}
        <label class="grid gap-1.5">
          <span class="text-[12.5px] font-medium text-[var(--kern-ink-700)]">{field.label}</span>
          <input
            type={field.type ?? 'text'}
            bind:value={values[field.key]}
            placeholder={field.hint ?? ''}
            autocomplete="off"
            class="h-[34px] rounded-[9px] border border-[var(--kern-border)] bg-[var(--kern-surface-input)] px-2.5 text-[13px] text-[var(--kern-ink-900)]"
          />
          {#if values[field.key] === SECRET_PLACEHOLDER}
            <span class="text-[11.5px] text-[var(--kern-ink-400)]">
              Stored securely — leave as is to keep it
            </span>
          {/if}
        </label>
      {/each}

      {#if message}
        <p
          role="status"
          class="rounded-[9px] px-3 py-2 text-[12.5px] {message.kind === 'ok'
            ? 'bg-[var(--kern-success-tint)] text-[var(--kern-success)]'
            : 'bg-[var(--kern-danger-tint)] text-[var(--kern-danger)]'}"
        >
          {message.text}
        </p>
      {/if}

      <div class="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          class="h-[34px] rounded-[9px] bg-[var(--kern-ink-900)] px-3.5 text-[13px] font-medium text-[var(--kern-ink-inverse)] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        <span class="flex-1"></span>

        <input
          type="email"
          bind:value={recipient}
          placeholder="you@example.com"
          class="h-[34px] w-[220px] rounded-[9px] border border-[var(--kern-border)] bg-[var(--kern-surface-input)] px-2.5 text-[13px]"
        />
        <button
          type="button"
          onclick={sendTest}
          disabled={testing || !recipient}
          class="h-[34px] rounded-[9px] border border-[var(--kern-border)] px-3 text-[13px] text-[var(--kern-ink-700)] disabled:opacity-50"
        >
          {testing ? 'Sending…' : 'Send test'}
        </button>
      </div>
    </form>
  {/if}
</section>
