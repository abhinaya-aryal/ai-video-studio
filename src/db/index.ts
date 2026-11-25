import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getConfig } from "@/lib/config";
import * as schema from "./schema";
import type { Project } from "./schema";

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

export const QUICK_CLIPS_SLUG = "_quick-clips";

const BUILTIN_STYLE_PRESETS = [
  {
    id: "preset-cinematic",
    name: "Cinematic",
    styleBible:
      "Anamorphic widescreen cinema look, moody motivated lighting, shallow depth of field, rich filmic contrast, subtle film grain, grounded realistic textures.",
    isBuiltin: 1,
  },
  {
    id: "preset-anime",
    name: "Anime",
    styleBible:
      "High-craft Japanese anime feature aesthetic, expressive clean linework, cel-shaded lighting with atmospheric bloom, painted backgrounds, dynamic framing.",
    isBuiltin: 1,
  },
  {
    id: "preset-documentary",
    name: "Documentary",
    styleBible:
      "Naturalistic handheld documentary cinematography, authentic available light, crisp observational framing, true-to-life color grading.",
    isBuiltin: 1,
  },
  {
    id: "preset-product",
    name: "Product",
    styleBible:
      "Clean commercial studio showcase, precision rim lighting, glossy macro highlights, controlled neutral backdrop, smooth motorized camera glides.",
    isBuiltin: 1,
  },
] as const;

interface DbEntry {
  db: DrizzleDb;
  sqlite: Database.Database;
}

const globalForDb = globalThis as typeof globalThis & {
  __aivsDbCache?: Map<string, DbEntry>;
};

function getDbCache(): Map<string, DbEntry> {
  if (!globalForDb.__aivsDbCache) {
    globalForDb.__aivsDbCache = new Map<string, DbEntry>();
  }
  return globalForDb.__aivsDbCache;
}

function seedBuiltinStylePresets(db: DrizzleDb): void {
  db.insert(schema.stylePresets)
    .values([...BUILTIN_STYLE_PRESETS])
    .onConflictDoNothing()
    .run();
}

/**
 * Return the Drizzle SQLite singleton for the current `DATA_DIR`,
 * running migrations and idempotently seeding built-in style presets on first open.
 */
export function getDb(): DrizzleDb {
  const { dataDir } = getConfig();
  const dbPath = path.resolve(dataDir, "studio.db");
  const cache = getDbCache();

  const existing = cache.get(dbPath);
  if (existing) {
    return existing.db;
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  migrate(db, { migrationsFolder });
  seedBuiltinStylePresets(db);

  cache.set(dbPath, { db, sqlite });
  return db;
}

/** Close all cached SQLite connections (intended for test teardown). */
export function closeDbForTests(): void {
  const cache = globalForDb.__aivsDbCache;
  if (!cache) return;

  for (const entry of cache.values()) {
    entry.sqlite.close();
  }
  cache.clear();
}

/** Return the hidden `_quick-clips` project, creating it idempotently if missing. */
export function getOrCreateQuickClipProject(): Project {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.slug, QUICK_CLIPS_SLUG))
    .get();

  if (existing) {
    return existing;
  }

  const now = Date.now();
  db.insert(schema.projects)
    .values({
      id: randomUUID(),
      slug: QUICK_CLIPS_SLUG,
      title: "Quick Clips",
      isHidden: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.projects.slug })
    .run();

  const created = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.slug, QUICK_CLIPS_SLUG))
    .get();

  if (!created) {
    throw new Error("Failed to load or create Quick Clips project");
  }

  return created;
}

export * from "./schema";
