CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "backups_server_type_idx" ON "backups" USING btree ("server_id","type");--> statement-breakpoint
CREATE INDEX "servers_node_idx" ON "servers" USING btree ("node_id");