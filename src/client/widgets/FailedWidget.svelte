<script lang="ts">
import type { WidgetProps } from '@kernhq/ui'
import { formatCount, StatTile } from '@kernhq/ui'
import { createQuery } from '@tanstack/svelte-query'
import { getMailApi } from '../api-instance.js'
import { t } from '../i18n.js'

/**
 * Failed sends, of the last fifty.
 *
 * `deliveries.list` returns a page and no total, and has no date filter, so a bare number here would
 * be a claim the API cannot support. The note says exactly what the figure covers instead — a
 * smaller true statement beats a bigger invented one. A real total needs a `deliveries.stats`
 * procedure in the mail module first.
 */
let { workspaceId, workspaceSlug }: WidgetProps = $props()

const WINDOW = 50

const api = getMailApi()
const query = createQuery(() => ({
  queryKey: ['mail', 'delivery', workspaceId, 'failed', WINDOW],
  queryFn: () => api.deliveries.list({ workspaceId, limit: WINDOW }),
  enabled: Boolean(workspaceId),
}))

const failed = $derived(
  (query.data?.items ?? []).filter((d) => d.status === 'failed' || d.status === 'bounced').length,
)
</script>

<div class="wrap">
  <StatTile
    label={t('widget_failed_title')}
    value={query.isPending ? '—' : formatCount(failed)}
    note={t('widget_failed_note', { count: formatCount(WINDOW) })}
    href="/{workspaceSlug}/settings/mail"
    size="md"
    class="tile"
  />
</div>

<style>
  .wrap {
    display: grid;
    align-content: center;
    height: 100%;
    padding: 14px 16px;
  }
  .wrap :global(.tile) {
    border: 0;
    background: transparent;
    padding: 0;
  }
</style>
