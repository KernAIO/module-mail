import { moduleSchema, sql } from '@kernhq/kernel'
import { index, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const schema = moduleSchema('mail')

/** One row per outbound message. `workspace_id` is null for instance-level mail. */
export const deliveries = schema.table(
  'deliveries',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id'),
    to: text('to').array().notNull(),
    subject: text('subject').notNull(),
    provider: text('provider').notNull(),
    template: text('template'),
    status: text('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('deliveries_ws_idx').on(t.workspaceId, t.createdAt),
    index('deliveries_pmid_idx').on(t.providerMessageId),
  ],
)

/** Addresses we must not send to. `workspace_id` null = instance-wide suppression. */
export const suppressions = schema.table(
  'suppressions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id'),
    email: text('email').notNull(),
    reason: text('reason').notNull(),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('suppressions_email_idx').on(t.email, t.workspaceId)],
)

/** Placeholder for intake addresses (`intake+token@…`) routed to tracker/recruit/CRM. */
export const inboundRoutes = schema.table(
  'inbound_routes',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id').notNull(),
    token: text('token').notNull().unique(),
    /** object ref string, e.g. `tracker:project:<id>` */
    target: text('target').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('inbound_routes_ws_idx').on(t.workspaceId)],
)
