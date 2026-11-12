-- Irreversible: drops changed_at and summary_of, which 0001 added, for version and
-- summary_of_version. Nothing is lost: both only stamped when the summary was read, and
-- every summary is read again at the next start (backfillSummaries, as summary_of_version
-- starts null). No release ever read them (0001 and 0002 ship together), so a rollback
-- to the code before 0001 ignores the new columns. Safe for the single-process launchd
-- deploy (server/ops), which migrates at start before serving; a deploy running old and
-- new servers side by side would have to keep the dropped columns one release instead.
ALTER TABLE "sessions" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "summary_of_version" integer;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "changed_at";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "summary_of";