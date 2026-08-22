import { defineConfig } from 'drizzle-kit'
// Generates SQL migrations for this module's own schema. Run: pnpm db:generate
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/schema.ts',
  out: './migrations',
  schemaFilter: ['mod_mail'],
})
