CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text DEFAULT 'classic' NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"rated" boolean DEFAULT false NOT NULL,
	"player_a_id" text,
	"player_b_id" text,
	"bot_level" text,
	"winner_id" text,
	"result_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"move_count" integer DEFAULT 0 NOT NULL,
	"ruleset_json" jsonb,
	"boards_json" jsonb,
	"rating_delta_a" double precision,
	"rating_delta_b" double precision,
	CONSTRAINT "games_mode_valid" CHECK ("mode" in ('classic', 'salvo')),
	CONSTRAINT "games_type_valid" CHECK ("type" in ('bot', 'private', 'quickmatch')),
	CONSTRAINT "games_status_valid" CHECK ("status" in ('live', 'completed', 'aborted')),
	CONSTRAINT "games_result_reason_valid" CHECK ("result_reason" is null or "result_reason" in ('sunk_all', 'forfeit', 'timeout', 'disconnect')),
	CONSTRAINT "games_bot_level_valid" CHECK ("bot_level" is null or "bot_level" in ('easy', 'medium', 'hard')),
	CONSTRAINT "games_bot_shape" CHECK (("type" = 'bot' and "bot_level" is not null and "player_b_id" is null)
          or ("type" <> 'bot' and "bot_level" is null)),
	CONSTRAINT "games_bot_games_unrated" CHECK (not "rated" or "type" <> 'bot'),
	CONSTRAINT "games_rating_delta_requires_rated" CHECK ("rated" or ("rating_delta_a" is null and "rating_delta_b" is null)),
	CONSTRAINT "games_winner_is_a_player" CHECK ("winner_id" is null or "winner_id" = "player_a_id" or "winner_id" = "player_b_id"),
	CONSTRAINT "games_status_coherent" CHECK (("status" = 'live' and "ended_at" is null and "winner_id" is null and "result_reason" is null)
          or ("status" = 'completed' and "ended_at" is not null and "result_reason" is not null)
          or ("status" = 'aborted' and "ended_at" is not null)),
	CONSTRAINT "games_move_count_non_negative" CHECK ("move_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"user_id" text NOT NULL,
	"owner_is_anonymous" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'classic' NOT NULL,
	"rating" double precision DEFAULT 1500 NOT NULL,
	"rd" double precision DEFAULT 350 NOT NULL,
	"volatility" double precision,
	"last_rating_period_at" timestamp with time zone,
	"games_rated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_user_id_mode_pk" PRIMARY KEY("user_id","mode"),
	CONSTRAINT "ratings_mode_valid" CHECK ("mode" in ('classic', 'salvo')),
	CONSTRAINT "ratings_owner_is_registered" CHECK ("owner_is_anonymous" = false),
	CONSTRAINT "ratings_rd_non_negative" CHECK ("rd" >= 0),
	CONSTRAINT "ratings_games_rated_non_negative" CHECK ("games_rated" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "avatar_seed" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "claimed_from_guest_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_id_is_anonymous_key" UNIQUE("id","is_anonymous");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_locale_valid" CHECK ("locale" is null or "locale" in ('en', 'de', 'es', 'it', 'fr'));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_player_a_id_user_id_fk" FOREIGN KEY ("player_a_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_player_b_id_user_id_fk" FOREIGN KEY ("player_b_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_winner_id_user_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_registered_user_fk" FOREIGN KEY ("user_id","owner_is_anonymous") REFERENCES "public"."user"("id","is_anonymous") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "games_player_a_ended_at_idx" ON "games" USING btree ("player_a_id","ended_at");--> statement-breakpoint
CREATE INDEX "games_player_b_ended_at_idx" ON "games" USING btree ("player_b_id","ended_at");--> statement-breakpoint
CREATE INDEX "ratings_mode_rating_idx" ON "ratings" USING btree ("mode","rating" DESC NULLS LAST);
