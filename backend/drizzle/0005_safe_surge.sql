CREATE TABLE "nodes" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"docker_host" varchar(255),
	"docker_port" integer,
	"tls_ca" text,
	"tls_cert" text,
	"tls_key" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"drained" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- the platform invariant: the API host's own daemon always exists as 'local'
INSERT INTO "nodes" ("id", "name") VALUES ('local', 'Local node') ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "node_id" varchar(32) DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;