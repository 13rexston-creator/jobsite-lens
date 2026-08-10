import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const procoreConnections = sqliteTable("procore_connections", {
  userId: text("user_id").primaryKey(),
  userEmail: text("user_email").notNull(),
  procoreUserId: text("procore_user_id").notNull(),
  procoreLogin: text("procore_login").notNull(),
  procoreName: text("procore_name"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: integer("expires_at").notNull(),
  connectedAt: integer("connected_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
