import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { createdAtColumn, idColumn, projectIdColumn } from './columns'
import { assetKindEnum, assetSourceEnum } from './production-enums'
import { projects, users } from './tenancy'

/**
 * Stored media for the Production route: a shot's frame, a reel's sheet, a
 * scene's still, a reference image, a clip and its poster, an upload. The
 * spec's `assets` (`docs/production/production.md` §7). AUTHORED - written
 * by an upload or by a finished generation, never derived.
 *
 * The row stores the **object key**, never a URL: the public URL is composed
 * at read (`apps/web/lib/storage/r2.ts`, `publicUrl`), the way
 * `characters.portrait_key` and `locations.photo_key` are read. The
 * Storyboard's `frame_upload_url` / `frame_url` store URLs and are the older
 * shape; nothing new is written that way.
 *
 * Portraits and location photos stay on their own rows - they are other
 * routes' and predate this table. An asset here is Production's only.
 */
export const assets = pgTable(
  'assets',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    kind: assetKindEnum('kind').notNull(),
    /** The R2 object key. `projects/<projectId>/production/<kind>/<uuid>.<ext>`. */
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    source: assetSourceEnum('source').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [index('assets_project_kind_idx').on(table.projectId, table.kind)],
)
