<script lang="ts">
import type { WidgetProps } from '@kernhq/ui'
import { Badge, relativeTime, settingsScope, WidgetState } from '@kernhq/ui'
import { createQuery } from '@tanstack/svelte-query'
import { getMailApi } from '../api-instance.js'
import { t } from '../i18n.js'

/**
 * What this workspace has been sending.
 *
 * The mail module is outbound only — there is no inbox to show, and `ROADMAP.md` defers one to
 * v1.1 — so this is about delivery health rather than about reading anything.
 */
let { workspaceId, workspaceSlug, settings }: WidgetProps = $props()

const api = getMailApi()
const limit = $derived(Number(settings.limit ?? 8))
const status = $derived((settings.status as string | null) ?? null)

const query = createQuery(() => ({
  queryKey: ['mail', 'delivery', workspaceId, 'widget', settingsScope(settings)],
  queryFn: () =>
    api.deliveries.list({
      workspaceId,
      limit,
      status: (status ?? undefined) as never,
    }),
  enabled: Boolean(workspaceId),
}))

const tone = (s: string) =>
  s === 'failed' || s === 'bounced' ? 'danger' : s === 'sent' || s === 'delivered' ? 'done' : 'grey'

const items = $derived(query.data?.items ?? [])
</script>

<WidgetState
  pending={query.isPending}
  error={query.error}
  empty={items.length === 0}
  emptyTitle={t('widget_empty')}
  emptyIcon="mail"
  onRetry={() => query.refetch()}
>
  <ul>
    {#each items as delivery (delivery.id)}
      <li>
        <a href="/{workspaceSlug}/settings/mail">
          <span class="text">
            <span class="subject">{delivery.subject}</span>
            <span class="to">{delivery.to.join(', ')}</span>
          </span>
          <Badge tone={tone(delivery.status)} variant="chip">{delivery.status}</Badge>
          <time datetime={delivery.createdAt}>{relativeTime(delivery.createdAt)}</time>
        </a>
      </li>
    {/each}
  </ul>
</WidgetState>

<style>
  li {
    border-block-end: 1px solid var(--kern-border-hairline);
  }
  li:last-child {
    border-block-end: 0;
  }
  a {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 14px;
    color: inherit;
  }
  a:hover {
    background: var(--kern-surface-hover);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .subject,
  .to {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .subject {
    font-size: 13px;
    color: var(--kern-ink-900);
  }
  .to {
    font-size: 12px;
    color: var(--kern-ink-450);
  }
  time {
    flex-shrink: 0;
    font-family: var(--kern-font-mono);
    font-size: 11px;
    color: var(--kern-ink-400);
  }
</style>
