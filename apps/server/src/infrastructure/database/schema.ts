import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const savedGames = pgTable("saved_games", {
  id: uuid("id").defaultRandom().primaryKey(),
  imageId: text("image_id").notNull(),
  pieceCount: integer("piece_count").notNull(),
  seed: integer("seed").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
// Initial schema only. A migration and repository will be added with persistence.
