import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const planProjects = sqliteTable("plan_projects", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  source: text("source").notNull().default("upload"),
  vectorStoreId: text("vector_store_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_plan_projects_owner_name").on(table.ownerUserId, table.name),
  index("idx_plan_projects_owner_updated").on(table.ownerUserId, table.updatedAt),
]);

export const planFiles = sqliteTable("plan_files", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => planProjects.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull(),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  openaiFileId: text("openai_file_id"),
  vectorStoreFileId: text("vector_store_file_id"),
  status: text("status").notNull().default("uploading"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_plan_files_storage_key").on(table.storageKey),
  uniqueIndex("idx_plan_files_project_sha256").on(table.projectId, table.sha256),
  index("idx_plan_files_project_created").on(table.projectId, table.createdAt),
  index("idx_plan_files_owner_status").on(table.ownerUserId, table.status),
]);

export const planPages = sqliteTable("plan_pages", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull().references(() => planFiles.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => planProjects.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull(),
  pageNumber: integer("page_number").notNull(),
  pageCount: integer("page_count").notNull(),
  storageKey: text("storage_key"),
  imageSize: integer("image_size"),
  width: integer("width"),
  height: integer("height"),
  extractedText: text("extracted_text").notNull().default(""),
  isCandidate: integer("is_candidate", { mode: "boolean" }).notNull().default(false),
  analysisStatus: text("analysis_status").notNull().default("pending"),
  analysisJson: text("analysis_json"),
  analysisError: text("analysis_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_plan_pages_file_page").on(table.fileId, table.pageNumber),
  uniqueIndex("idx_plan_pages_storage_key").on(table.storageKey),
  index("idx_plan_pages_project_candidate_status").on(table.projectId, table.isCandidate, table.analysisStatus),
]);

export const chatgptConnections = sqliteTable("chatgpt_connections", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
}, (table) => [
  uniqueIndex("idx_chatgpt_connections_token_hash").on(table.tokenHash),
  index("idx_chatgpt_connections_owner_revoked").on(table.ownerUserId, table.revokedAt),
]);
