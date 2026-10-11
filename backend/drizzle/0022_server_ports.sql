--> statement-breakpoint
-- Host ports assigned to sandboxes, one row per (node, port) allocation.
CREATE TYPE "public"."port_protocol" AS ENUM('tcp', 'udp');
--> statement-breakpoint
CREATE TYPE "public"."port_state" AS ENUM('allocated', 'released');
--> statement-breakpoint
CREATE TABLE "server_ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
	"node_id" varchar(32) NOT NULL REFERENCES "nodes"("id") ON DELETE CASCADE,
	"port" integer NOT NULL,
	"protocol" "public"."port_protocol" DEFAULT 'tcp' NOT NULL,
	"container_port" integer NOT NULL,
	"state" "public"."port_state" DEFAULT 'allocated' NOT NULL,
	"reason" varchar(120),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"released_at" timestamp,
	CONSTRAINT "server_ports_range_ck" CHECK ("port" BETWEEN 1024 AND 65535),
	CONSTRAINT "server_ports_container_ck" CHECK ("container_port" BETWEEN 1 AND 65535)
);
--> statement-breakpoint
-- The real guard against two servers sharing a port on one node: only an
-- ALLOCATED row may exist for a (node, port) pair, so a released port becomes
-- immediately reusable and the race is decided by the database.
CREATE UNIQUE INDEX "server_ports_node_port_unique" ON "server_ports" ("node_id", "port") WHERE "state" = 'allocated';
--> statement-breakpoint
CREATE INDEX "server_ports_server_idx" ON "server_ports" ("server_id", "state");
--> statement-breakpoint
-- A server keeps at most one live allocation of each protocol.
CREATE UNIQUE INDEX "server_ports_server_proto_unique" ON "server_ports" ("server_id", "protocol") WHERE "state" = 'allocated';
>>> statement-breakpoint
-- The address clients connect TO (e.g. node.hosting.troxe.dev). Separate from
-- docker_host, which is the internal daemon address and may be private.
ALTER TABLE "nodes" ADD COLUMN "public_host" varchar(255);
