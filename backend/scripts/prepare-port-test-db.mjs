/**
 * Build a throwaway PostgreSQL database with EXACTLY the shipped
 * `server_ports` + `nodes` definitions (extracted from the migration, not
 * hand-written) so the port-allocation tests exercise the real indexes and
 * constraints rather than an approximation.
 *
 * Refuses to run unless the target URL points at a database whose name ends in
 * a throwaway marker, so it can never be aimed at the fleet.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = process.env.DESTRUCTIVE_DATABASE_URL;
if (!URL) {
  console.error('DESTRUCTIVE_DATABASE_URL is required.');
  process.exit(1);
}
// database name = the last path segment of the connection URL
const m = /\/(?:[^/]*\/)*([^/?#]+)(?:[?#].*)?$/.exec(URL);
const name = m ? m[1] : '';
if (!/(test|tmp|scratch|throwaway)/i.test(name)) {
  console.error(`Refusing to touch database "${name}" — its name does not look throwaway.`);
  process.exit(1);
}

const migration = readFileSync(resolve('drizzle/0022_server_ports.sql'), 'utf8');
const nodeRange = readFileSync(resolve('drizzle/0029_port_health_and_node_range.sql'), 'utf8');

/**
 * Split a migration into statements, dropping the leading `--` comment block
 * of each one.
 *
 * The comments matter: migrations explain WHY right above the statement, so a
 * naive `startsWith()` filter silently drops every commented statement and the
 * test then runs against a schema that is missing exactly the parts it is
 * meant to verify.
 */
const split = (sql) =>
  sql
    .split('--> statement-breakpoint')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);

// from 0022: the enums, the table with its constraints, and both unique
// indexes. The `nodes` column add is dropped — the stub below supersedes it.
const portStatements = split(migration).filter((s) => !s.includes('ALTER TABLE "nodes"'));

// from 0029: the index rebuild, the health columns and their CHECK. Selected
// by "mentions server_ports" rather than by a `startsWith` list, so the DO $$
// blocks that carry the constraints are kept too — a startsWith filter drops
// every guarded constraint, which is exactly the part under test.
const healthStatements = split(nodeRange).filter((s) => s.includes('server_ports'));

const schema = [
  'drop table if exists server_ports cascade;',
  'drop table if exists servers cascade;',
  'drop table if exists nodes cascade;',
  'drop type if exists port_state cascade;',
  'drop type if exists port_protocol cascade;',
  // Both FK targets are stubbed and created BEFORE `server_ports`, which
  // references them. The allocation tests never read those rows — they only
  // need the referential integrity the real tables provide.
  `create table servers (id uuid primary key);`,
  `create table nodes (
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
   );`,
  ...portStatements,
  ...healthStatements,
  `insert into nodes (id, name) values ('local','Local node') on conflict do nothing;`,
].join('\n');

const out = resolve('test/integration/.schema.sql');
writeFileSync(out, schema);
console.log(`wrote ${out} (${schema.length} bytes)`);