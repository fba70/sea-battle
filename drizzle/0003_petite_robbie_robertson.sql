CREATE TABLE "matchmaking_queue" (
	"user_id" text PRIMARY KEY NOT NULL,
	"pool" text NOT NULL,
	"mode" text DEFAULT 'classic' NOT NULL,
	"rating" double precision DEFAULT 1500 NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matchmaking_queue_pool_valid" CHECK ("pool" in ('rated', 'unrated')),
	CONSTRAINT "matchmaking_queue_mode_valid" CHECK ("mode" in ('classic', 'salvo'))
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "join_code" text;--> statement-breakpoint
ALTER TABLE "matchmaking_queue" ADD CONSTRAINT "matchmaking_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matchmaking_queue_pool_enqueued_idx" ON "matchmaking_queue" USING btree ("pool","enqueued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "games_join_code_key" ON "games" USING btree ("join_code");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_join_code_shape" CHECK ("join_code" is null or ("type" = 'private' and "join_code" ~ '^[A-Z0-9]{4,12}$'));