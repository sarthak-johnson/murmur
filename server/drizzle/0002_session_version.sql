ALTER TABLE "sessions" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "summary_of_version" integer;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "changed_at";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "summary_of";