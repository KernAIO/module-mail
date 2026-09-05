<script lang="ts">
import {
  Badge,
  Button,
  Dialog,
  Input,
  messageLocale,
  SearchBox,
  Select,
  SettingsPage,
  SettingsSection,
  Spinner,
  session,
  toast,
} from '@kernhq/ui'
import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query'
import type { MailDelivery, MailSuppression, MailTestStatus } from '../../contract.js'
import { getMailApi } from '../api-instance.js'
import { t } from '../i18n.js'
import { SECRET_PLACEHOLDER } from '../index.js'
import { canMail } from '../permissions.js'

/**
 * Where this workspace's email comes from, and what it has sent.
 *
 * The module has been complete and unreachable: settings, a test send and a delivery log all had a
 * server and nothing that called them.
 *
 * Without a provider the workspace falls back to the instance's own configuration, which is why a
 * fresh self-hosted install already delivers invitations and password resets — so "use the instance
 * default" is a real choice rather than an unconfigured state.
 */
const api = getMailApi()
const queryClient = useQueryClient()

/**
 * The shell passes these; this component does not read the router.
 *
 * `$app/state` is a SvelteKit alias, and a module package is type-checked on its own — reaching for
 * the router here fails standalone even though it resolves inside the app. `ModuleRoute` already
 * hands every module page the workspace it is rendering, which is the only thing this needed it for.
 */
interface Props {
  workspaceId: string
  workspaceSlug: string
}
const { workspaceId }: Props = $props()
const canManage = $derived(canMail('settingsManage'))
const canSeeLog = $derived(canMail('deliveriesView'))

type Provider = 'platform' | 'smtp' | 'mailgun' | 'ses' | 'postmark' | 'resend'

/**
 * What each provider needs. Carried over from the module package, which is where this screen used
 * to live before it could be rendered.
 */
const FIELDS: Record<Provider, Array<{ key: string; label: () => string; type?: string; hint?: string }>> = {
  platform: [],
  smtp: [
    { key: 'host', label: () => t('field_host') },
    { key: 'port', label: () => t('field_port'), type: 'number' },
    { key: 'user', label: () => t('field_user') },
    { key: 'pass', label: () => t('field_password'), type: 'password' },
    { key: 'from', label: () => t('field_from'), hint: 'Kern <no-reply@example.com>' },
  ],
  mailgun: [
    { key: 'apiKey', label: () => t('field_api_key'), type: 'password' },
    { key: 'domain', label: () => t('field_domain') },
    { key: 'region', label: () => t('field_region'), hint: 'us / eu' },
    { key: 'from', label: () => t('field_from') },
  ],
  ses: [
    { key: 'accessKeyId', label: () => t('field_access_key') },
    { key: 'secretAccessKey', label: () => t('field_secret_key'), type: 'password' },
    { key: 'region', label: () => t('field_region'), hint: 'eu-west-1' },
    { key: 'from', label: () => t('field_from') },
  ],
  postmark: [
    { key: 'serverToken', label: () => t('field_server_token'), type: 'password' },
    { key: 'from', label: () => t('field_from') },
  ],
  resend: [
    { key: 'apiKey', label: () => t('field_api_key'), type: 'password' },
    { key: 'from', label: () => t('field_from') },
  ],
}

const PROVIDER_LABELS: Record<Provider, () => string> = {
  platform: () => t('provider_platform'),
  smtp: () => t('provider_smtp'),
  mailgun: () => t('provider_mailgun'),
  ses: () => t('provider_ses'),
  postmark: () => t('provider_postmark'),
  resend: () => t('provider_resend'),
}

let provider = $state<Provider>('platform')
let values = $state<Record<string, string>>({})
/** Set once from the server, so re-renders do not fight what is being typed. */
let loaded = $state(false)
let recipient = $state('')
let statusFilter = $state('')

const settingsQuery = createQuery(() => ({
  queryKey: ['mail', 'settings', workspaceId],
  queryFn: () => api.settings.get({ workspaceId }),
  enabled: Boolean(workspaceId),
}))

$effect(() => {
  const config = settingsQuery.data?.config
  if (loaded || settingsQuery.isPending) return
  if (config && typeof config.provider === 'string') {
    provider = config.provider as Provider
    values = Object.fromEntries(
      Object.entries(config)
        .filter(([k]) => k !== 'provider')
        .map(([k, v]) => [k, String(v ?? '')]),
    )
  }
  loaded = true
})

const fields = $derived(FIELDS[provider])

const save = createMutation(() => ({
  mutationFn: () =>
    api.settings.set({
      workspaceId,
      config:
        provider === 'platform'
          ? null
          : { provider, ...Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ''])) },
    }),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['mail', 'settings', workspaceId] })
    toast.success(t('saved'))
  },
  onError: (error: Error) => toast.error(error.message),
}))

/**
 * A test send, which is the only way to find out whether the credentials work.
 *
 * The provider's refusal comes back as a result rather than an error, so it is shown as one — a
 * rejected recipient is an answer, not a failure of the request. The server sends the message
 * inside the handler now, so a success here means the provider accepted it; whatever the answer,
 * the delivery log below is refreshed, because it is the record of what actually happened.
 */
const test = createMutation(() => ({
  mutationFn: () => api.settings.test({ workspaceId, to: recipient }),
  onSuccess: (result: { ok: boolean; error: string | null; status?: MailTestStatus }) => {
    if (result.ok) {
      toast.success(t('test_sent', { to: recipient }))
      return
    }
    if (result.status === 'timeout') toast.error(t('test_timeout'))
    else if (result.status === 'suppressed') toast.error(t('test_suppressed', { to: recipient }))
    else toast.error(result.error ?? t('test_refused'))
  },
  onError: (error: Error) => toast.error(error.message),
  onSettled: () => {
    void queryClient.invalidateQueries({ queryKey: ['mail', 'deliveries', workspaceId] })
  },
}))

const deliveriesQuery = createQuery(() => ({
  queryKey: ['mail', 'deliveries', workspaceId, statusFilter],
  queryFn: () =>
    api.deliveries.list({
      workspaceId,
      ...(statusFilter ? { status: statusFilter as MailDelivery['status'] } : {}),
    }),
  enabled: Boolean(workspaceId) && canSeeLog,
}))
const deliveries = $derived(deliveriesQuery.data?.items ?? [])

const STATUS_LABELS: Record<string, () => string> = {
  queued: () => t('status_queued'),
  sent: () => t('status_sent'),
  failed: () => t('status_failed'),
  bounced: () => t('status_bounced'),
}
const statusLabel = (status: string) => STATUS_LABELS[status]?.() ?? status
/** Only a failure has a tone: colouring every row makes the one that needs attention disappear. */
const statusTone = (status: string) =>
  status === 'bounced' || status === 'failed' ? 'danger' : status === 'queued' ? 'grey' : 'success'

const when = $derived(new Intl.DateTimeFormat(messageLocale(), { dateStyle: 'medium', timeStyle: 'short' }))

/**
 * The addresses nothing is sent to.
 *
 * One bounce, one full mailbox or one press of "report spam" writes a row that stops password
 * resets, sign-in links and invitations for ever, and until this section existed the only way back
 * was a SQL statement. The instance-wide rows are here too and marked as such: a bounce on a
 * sign-in link belongs to no workspace, so leaving them out would hide the case that hurts most.
 */
let search = $state('')
/** What is actually asked for — debounced, so a list is not fetched for every keystroke. */
let query = $state('')
$effect(() => {
  const next = search.trim()
  const timer = setTimeout(() => (query = next), 250)
  return () => clearTimeout(timer)
})

const blockedQuery = createQuery(() => ({
  queryKey: ['mail', 'suppressions', workspaceId, query],
  queryFn: () => api.suppressions.list({ workspaceId, ...(query ? { q: query } : {}) }),
  enabled: Boolean(workspaceId) && canManage,
}))
const blocked = $derived(blockedQuery.data?.items ?? [])

let removing = $state<MailSuppression | null>(null)
/**
 * The attribute reaches the button one render after the click, so two quick presses both file a
 * removal — the second answering 404. The flag is set in the same tick instead.
 */
let firing = $state(false)

const REASON_LABELS: Record<string, () => string> = {
  bounce: () => t('blocked_reason_bounce'),
  complaint: () => t('blocked_reason_complaint'),
  manual: () => t('blocked_reason_manual'),
}
const reasonLabel = (reason: string) => REASON_LABELS[reason]?.() ?? reason

const remove = createMutation(() => ({
  mutationFn: (row: MailSuppression) => api.suppressions.remove({ workspaceId, id: row.id }),
  onSuccess: (_result: { ok: boolean }, row: MailSuppression) => {
    toast.success(t('blocked_removed', { email: row.email }))
    removing = null
  },
  onError: (error: Error) => toast.error(error.message),
  onSettled: () => {
    firing = false
    void queryClient.invalidateQueries({ queryKey: ['mail', 'suppressions', workspaceId] })
  },
}))

function confirmRemoval() {
  const row = removing
  if (!row || firing) return
  firing = true
  remove.mutate(row)
}
</script>

<SettingsPage title={t('settings_title')} description={t('settings_hint')}>
  <SettingsSection title={t('provider_title')} description={t('provider_hint')}>
    {#if settingsQuery.isPending}
      <div class="state"><Spinner /></div>
    {:else}
      <div class="grid">
        <label class="row" data-testid="mail-provider">
          <span class="lbl">{t('provider_label')}</span>
          <Select
            value={provider}
            options={(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => ({
              value: p,
              label: PROVIDER_LABELS[p](),
            }))}
            disabled={!canManage}
            onValueChange={(v: string) => (provider = v as Provider)}
          />
        </label>

        {#each fields as field (field.key)}
          <label class="row">
            <span class="lbl">{field.label()}</span>
            <Input
              type={field.type ?? 'text'}
              value={values[field.key] ?? ''}
              placeholder={field.hint ?? ''}
              autocomplete="off"
              disabled={!canManage}
              data-testid="mail-{field.key}"
              oninput={(e: Event) =>
                (values = { ...values, [field.key]: (e.currentTarget as HTMLInputElement).value })}
            />
            {#if values[field.key] === SECRET_PLACEHOLDER}
              <!-- The server never returns a stored secret; sending the placeholder back keeps it.
                   Saying so is the difference between "already set" and "about to be blanked". -->
              <span class="hint">{t('secret_kept')}</span>
            {/if}
          </label>
        {/each}
      </div>
    {/if}

    {#snippet footer()}
      <Button
        size="sm"
        disabled={!canManage}
        loading={save.isPending}
        onclick={() => save.mutate()}
        data-testid="mail-save"
      >
        {t('common.save')}
      </Button>
    {/snippet}
  </SettingsSection>

  <SettingsSection title={t('test_title')} description={t('test_hint')}>
    <div class="testrow">
      <Input
        type="email"
        bind:value={recipient}
        placeholder={session.user?.email ?? 'you@example.com'}
        disabled={!canManage}
        data-testid="mail-test-to"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!canManage || !recipient.trim()}
        loading={test.isPending}
        onclick={() => test.mutate()}
        data-testid="mail-test-send"
      >
        {t('test_send')}
      </Button>
    </div>
  </SettingsSection>

  {#if canManage}
    <SettingsSection title={t('blocked_title')} description={t('blocked_hint')}>
      <div class="filter">
        <SearchBox
          bind:value={search}
          placeholder={t('blocked_search')}
          label={t('blocked_search')}
          data-testid="mail-blocked-search"
        />
      </div>

      {#if blockedQuery.isPending}
        <div class="state"><Spinner /></div>
      {:else if !blocked.length}
        <p class="empty">{query ? t('blocked_none_found', { q: query }) : t('blocked_empty')}</p>
      {:else}
        <ul class="log" data-testid="mail-blocked">
          {#each blocked as row (row.id)}
            <li>
              <div class="top">
                <span class="addr">{row.email}</span>
                <Badge tone="grey">{reasonLabel(row.reason)}</Badge>
                {#if row.workspaceId === null}
                  <!-- Instance-wide: this is the row that stops password resets and sign-in links,
                       and removing it lets every workspace send to the address again. -->
                  <Badge tone="warning">{t('blocked_scope_instance')}</Badge>
                {/if}
                <span class="spacer"></span>
                <span class="when">{when.format(new Date(row.createdAt))}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onclick={() => (removing = row)}
                  data-testid="mail-blocked-remove"
                >
                  {t('common.remove')}
                </Button>
              </div>
              {#if row.source}
                <div class="meta"><span>{row.source}</span></div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </SettingsSection>
  {/if}

  {#if canSeeLog}
    <SettingsSection title={t('log_title')} description={t('log_hint')}>
      <div class="filter" data-testid="mail-log-filter">
        <Select
          value={statusFilter}
          options={[
            { value: '', label: t('log_all') },
            ...['sent', 'queued', 'failed', 'bounced'].map((s) => ({ value: s, label: statusLabel(s) })),
          ]}
          onValueChange={(v: string) => (statusFilter = v)}
        />
      </div>

      {#if deliveriesQuery.isPending}
        <div class="state"><Spinner /></div>
      {:else if !deliveries.length}
        <p class="empty">{t('log_empty')}</p>
      {:else}
        <ul class="log" data-testid="mail-log">
          {#each deliveries as delivery (delivery.id)}
            <li>
              <div class="top">
                <Badge tone={statusTone(delivery.status)}>{statusLabel(delivery.status)}</Badge>
                <span class="subject">{delivery.subject}</span>
                <span class="when">{when.format(new Date(delivery.createdAt))}</span>
              </div>
              <div class="meta">
                <span>{delivery.to.join(', ')}</span>
                {#if delivery.template}<span>{delivery.template}</span>{/if}
              </div>
              {#if delivery.error}
                <!-- The provider's own words. A message that could not be delivered is only
                     actionable if you can read why the other end refused it. -->
                <p class="err">{delivery.error}</p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </SettingsSection>
  {/if}
</SettingsPage>

<!--
  Removing a suppression is not undoable in the sense that matters: the provider refused this
  address once, and letting it through again is a decision about the instance's sending reputation
  as much as about one person. So it is confirmed, and the confirmation says what happens next.
-->
<Dialog
  open={removing !== null}
  size="sm"
  title={removing ? t('blocked_confirm_title', { email: removing.email }) : ''}
  onOpenChange={(open: boolean) => {
    if (!open) removing = null
  }}
>
  {#if removing}
    <p class="body">{t('blocked_confirm_body', { email: removing.email })}</p>
    {#if removing.workspaceId === null}
      <p class="body warn">{t('blocked_confirm_instance')}</p>
    {/if}
  {/if}

  {#snippet footer()}
    <Button variant="secondary" onclick={() => (removing = null)}>{t('common.cancel')}</Button>
    <Button
      variant="danger"
      loading={remove.isPending}
      onclick={confirmRemoval}
      data-testid="mail-blocked-confirm"
    >
      {t('common.remove')}
    </Button>
  {/snippet}
</Dialog>

<style>
.grid {
  display: grid;
  gap: 12px;
}
.row {
  display: grid;
  gap: 4px;
}
.lbl {
  font-size: 12px;
  font-weight: 500;
  color: var(--kern-ink-600);
}
.hint {
  font-size: 11.5px;
  color: var(--kern-ink-400);
}
.testrow {
  display: grid;
  grid-template-columns: minmax(0, 260px) auto;
  align-items: center;
  gap: 8px;
}
.filter {
  max-width: 200px;
  margin-bottom: 10px;
}
.log {
  list-style: none;
  margin: 0;
  padding: 0;
}
.log li {
  padding: 8px 0;
  border-bottom: 1px solid var(--kern-border-hairline);
}
.log li:last-child {
  border-bottom: 0;
}
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
/* Pushes the date and the action to the end of the row, in either direction. */
.spacer {
  flex: 1;
}
.addr {
  min-width: 0;
  max-width: 100%;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subject {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when {
  font-size: 12px;
  color: var(--kern-ink-400);
  white-space: nowrap;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--kern-ink-400);
}
.err {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--kern-danger);
  overflow-wrap: anywhere;
}
.empty {
  margin: 0;
  font-size: 13px;
  color: var(--kern-ink-400);
}
.body {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--kern-ink-600);
}
.body:last-child {
  margin-bottom: 0;
}
/* A colour, not an opacity: a faded paragraph is unreadable whatever its token says.
   Measured on both dialog surfaces — 5.2:1 light, 6.3:1 dark. */
.warn {
  color: var(--kern-warning);
}
.state {
  display: grid;
  place-items: center;
  padding: 24px;
}
</style>
