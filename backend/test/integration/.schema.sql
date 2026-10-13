drop table if exists server_ports cascade;
drop table if exists servers cascade;
drop table if exists nodes cascade;
drop type if exists port_state cascade;
drop type if exists port_protocol cascade;
create table servers (id uuid primary key);
create table nodes (
     id varchar(32) primary key,
     name varchar(64) not null,
     docker_host varchar(255),
     public_host varchar(255),
     subnet_base varchar(18),
     port_range_from integer,
     port_range_to integer,
     enabled boolean not null default true,
     constraint nodes_port_range_check check (
       port_range_from is null or port_range_to is null
       or (port_range_from >= 1024 and port_range_to <= 65535 and port_range_from <= port_range_to)
     )
   );
DO $$ BEGIN
  CREATE TYPE "public"."port_protocol" AS ENUM('tcp', 'udp');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."port_state" AS ENUM('allocated', 'released');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS "server_ports" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "server_ports_node_port_unique" ON "server_ports" ("node_id", "port") WHERE "state" = 'allocated';
CREATE INDEX IF NOT EXISTS "server_ports_server_idx" ON "server_ports" ("server_id", "state");
CREATE UNIQUE INDEX IF NOT EXISTS "server_ports_server_proto_unique" ON "server_ports" ("server_id", "protocol") WHERE "state" = 'allocated';
DROP INDEX IF EXISTS "server_ports_node_port_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "server_ports_node_port_unique" ON "server_ports" ("node_id", "port") WHERE "state" = 'allocated';
DROP INDEX IF EXISTS "server_ports_server_proto_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "server_ports_server_proto_unique" ON "server_ports" ("server_id", "protocol") WHERE "state" = 'allocated';
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "container_listening" boolean;
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "container_checked_at" timestamp;
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "host_reachable" boolean;
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "host_checked_at" timestamp;
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "drift" varchar(16);
DO $$ BEGIN
  ALTER TABLE "server_ports" ADD CONSTRAINT "server_ports_drift_check"
    CHECK ("drift" IS NULL OR "drift" IN ('missing', 'extra'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
insert into nodes (id, name) values ('local','Local node') on conflict do nothing;