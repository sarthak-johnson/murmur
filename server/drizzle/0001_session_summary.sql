ALTER TABLE "sessions" ADD COLUMN "changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "summary" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "summary_of" timestamp with time zone;