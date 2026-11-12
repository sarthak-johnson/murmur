import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { SessionSummary } from "../summary.js";

const tstz = (name: string) => timestamp(name, { withTimezone: true });
const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  retentionDays: integer("retention_days").notNull().default(90),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const webSessions = pgTable("web_sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: userId(),
  expiresAt: tstz("expires_at").notNull(),
});

export const deviceCodes = pgTable("device_codes", {
  deviceCodeHash: text("device_code_hash").primaryKey(),
  userCode: text("user_code").notNull().unique(),
  machineName: text("machine_name").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  approvedAt: tstz("approved_at"),
  consumedAt: tstz("consumed_at"),
  expiresAt: tstz("expires_at").notNull(),
});

export const ingestTokens = pgTable("ingest_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: userId(),
  machineId: uuid("machine_id").notNull(),
  machineName: text("machine_name").notNull(),
  createdAt: tstz("created_at").notNull().defaultNow(),
  lastUsedAt: tstz("last_used_at"),
  revokedAt: tstz("revoked_at"),
});

export const sessions = pgTable(
  "sessions",
  {
    userId: userId(),
    sessionId: text("session_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    cwd: text("cwd").notNull(),
    title: text("title"),
    startedAt: tstz("started_at").notNull(),
    lastEventAt: tstz("last_event_at").notNull(),
    ended: boolean("ended").notNull().default(false),
    /** When an ingest last touched it (server time): a summary of an older one is stale. */
    changedAt: tstz("changed_at").notNull().defaultNow(),
    /** What the lobby reads of the session, from core's view of it (summary.ts). */
    summary: jsonb("summary").$type<SessionSummary>(),
    /** The `changedAt` the summary was read at. */
    summaryOf: tstz("summary_of"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sessionId] })],
);

export const events = pgTable(
  "events",
  {
    userId: userId(),
    id: uuid("id").notNull(),
    sessionId: text("session_id").notNull(),
    ts: tstz("ts").notNull(),
    hook: text("hook").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("events_user_session_ts_idx").on(t.userId, t.sessionId, t.ts),
  ],
);

export const assumptionDecisions = pgTable(
  "assumption_decisions",
  {
    userId: userId(),
    sessionId: text("session_id").notNull(),
    key: text("key").notNull(),
    decision: text("decision").notNull(),
    decidedAt: tstz("decided_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.sessionId, t.key] }),
    check(
      "assumption_decisions_decision_check",
      sql`${t.decision} in ('accepted','rejected')`,
    ),
  ],
);
