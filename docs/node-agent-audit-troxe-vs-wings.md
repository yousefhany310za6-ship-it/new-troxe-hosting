# تقرير تدقيق هندسي: Node Agent في Troxe Hosting مقابل Pterodactyl Wings

تاريخ التدقيق: Oct 13, 2026  
نوع التدقيق: Read-only engineering audit (comparative)

## 1. Executive Summary

- Troxe Hosting (commit `4fcb0817969826711cd67c3e892f1b3a71fa816b`) **does not use a separate per-node agent**. The central NestJS backend talks directly to Docker daemon:
  - local node: Unix socket
  - remote node: TLS-protected Docker daemon over TCP/mTLS
  - evidence: `backend/src/modules/nodes/node-pool.service.ts`, `backend/src/modules/servers/provisioning/docker.service.ts`
- Pterodactyl Wings (reviewed commit `5d9e2c34b6692ae48b1afb1b7bb61694439267b2`, tag `v1.13.3-23-g5d9e2c3`) **is a standalone Go daemon running on each node**. The Panel drives it, while Wings owns:
  - Docker container lifecycle
  - console attach and command input
  - SFTP
  - backups / restore / transfers
  - filesystem operations and quota
  - events and resource polling
  - evidence: `remote/http.go`, `server/manager.go`, `environment/docker/container.go`, `sftp/server.go`
- Troxe already has strong multi-tenant features:
  - per-server networks and host-level firewall hardening
  - database-atomic port allocation
  - reconciler for recovery
  - path-safe file manager
- Wings has strong node-runtime features:
  - process console attach
  - read-only rootfs + hardened container security options
  - SFTP
  - backups and disk quota filesystem
- Recommendation: keep Troxe’s central architecture for now, but refactor toward a stable Node Runtime Interface / lightweight Troxe Node Agent, borrowing proven Wings concepts selectively. Do not copy Wings code wholesale and do not cut-over all customer servers at once.

## 2. Scope and Methodology

- Read-only audit. No source files, dependency or project state were modified.
- Wings reference repository was cloned separately to `/tmp/opencode/pterodactyl-wings`.
- Static code inspection was used. No runtime tests, destructive experiments, network port probing or database mutations were performed.
- Claims marked as unverified where the reviewed code is insufficient.

## 3. Repository and Version Identification

- Troxe:
  - git branch: `main`
  - commit: `4fcb0817969826711cd67c3e892f1b3a71fa816b`
  - working tree status: clean
  - backend: NestJS, TypeScript, Drizzle, Dockerode
- Wings:
  - repository: https://github.com/pterodactyl/wings
  - clone path: `/tmp/opencode/pterodactyl-wings`
  - commit: `5d9e2c34b6692ae48b1afb1b7bb61694439267b2`
  - describe: `v1.13.3-23-g5d9e2c3`
  - module: Go 1.26 toolchain, Docker Go client, MIT license
- Host/build/runtime environment in Troxe backend can expose remote Docker daemons through DB-backed node records and mutual TLS (`node-pool.service.ts`, `nodes.service.ts`).

## 4. Troxe Hosting Current Architecture

ASCII architecture:

```text
Browser / User and Admin UI
            |
            v
NestJS Central Backend
  - ServersService
  - NodesService
  - PortsService
  - BackupsService
  - FilesService
  - ExecGateway
            |
            +-> NodePoolService (Docker client per node)
            |     - local: /var/run/docker.sock
            |     - remote: dockerHost + port + mutual TLS
            v
Docker daemon on selected node
  - per-server bridge network
  - per-server volume
  - per-server container
  - helper containers for file operations
            |
            v
Host OS + DOCKER-USER netfilter
```

Observed properties:

- Remote node registration stores Docker host/port (`nodes.dockerHost`, `nodes.dockerPort`) and optional overriding port range.
- Subnet allocation for per-server networks is controlled centrally using `NodesService.mustCidr` and overlap checks.
- Port allocation uses DB partial unique index behavior and is atomic (`PortsService.allocate`).
- `ReconcilerService` performs:
  - status synchronization
  - port drift synchronization
  - stuck provisioning detection
  - orphan garbage collection
  - crash-loop handling
  - hardening convergence
  - storage enforcement
  - automatic backups when due
- File operations are performed through helper containers rather than direct API process volume access (`FilesService`).
- Template-driven runtime definitions determine image and install/build steps (`provisioning/images.ts`, `templates/*`).

## 5. Pterodactyl Wings Architecture

Selected observations from official Wings code:

- Remote API client is in `remote/http.go` and uses base `.../api/remote`.
  - Authentication header: `Authorization: Bearer {tokenId}.{token}`
  - Content type and panel API accept headers.
  - Retry behavior via exponential backoff.
  - 5xx retry while 4xx treated as permanent failure.
  - request read timeout 15 seconds.
- Docker environment owns process state, stream attachment and resource polling (`environment/docker/environment.go`, `container.go`).
- Container creation uses read-only rootfs, tmpfs, `no-new-privileges`, dropped capabilities, DNS, network binding and cgroup resource limits (`container.go`).
- Console commands sent through `ContainerAttach` stdin stream after control-character filtering (`SendCommand`).
- SFTP server has:
  - panel credential validation
  - connection limits
  - handshake timeout
  - per-user authenticated connection limiting
  - IPv6 `/64` grouping
- Filesystem path handling and quota support are present, plus a large set of tests around symlink and archive extraction containment.
- Container resources can be updated in place, with some limitations if limits cannot be dynamically removed.

## 6. Detailed Functional Comparison

| Area | Troxe Hosting | Pterodactyl Wings | Actual difference | Security / impact | Recommendation |
|---|---|---|---|---|---|
| Node topology | Central backend directly manages Docker socket/TLS daemons | Independent Go daemon on each node | Troxe is centralized; Wings is distributed | Different failure and compromise boundaries | Keep now; define future agent interface |
| Node registration | Managed in `NodesService.create` and DB node table | Agent loads local node identity | Troxe stores connection metadata | Remote restart still needs Docker daemon access | documented pairing workflow required |
| TLS / auth | mTLS Docker daemon plus backend auth | Panel bearer token for agent APIs and retries | Different trust model | Latent hostname validation needs verify | Verify Dockerode TLS SAN handling |
| Server lifecycle | Fully central in NestJS | Panel -> agent model sync | Troxe couples compute and metadata | Easier immediate consistency but central blast radius | Stable state contract needed |
| Container creation | Image allowlist, per-server network/volume, rollback attempt, sandbox | Panel config, hardening, cap drop, readonly rootfs | Troxe has more isolation by default; Wings has stronger container hardening | High | Merge best practices |
| Port allocation | DB atomic allocation with conflict protection and health matrix | Bindings derived from panel allocations | Troxe strong against race collisions | Important for correctness | Keep |
| Network isolation | Great effort especially local rules/convergence and firewall reports | Bridge mode plus optional outgoing IP network | Different design philosophies | Troxe focuses cross-tenant firewalling; Wings focuses container runtime hardening | Retain Troxe approach |
| Resource CPU | cgroup limits from `SandboxSpec.cpuMilli` | `AsContainerResources` | Underlying comparable | Verify conversion and on-the-fly adjust | Tests |
| Resource RAM | cgroup memory limits from `ramMb` | same conceptual mechanism | Comparable | Docker update side effects | Tests |
| Storage | GB quota with helper disk usage checks and periodic enforcement | Filesystem quota and ufs mounts | Different quota levels | Storage enforcement depends on measurement | Cross-check implementation |
| Files | Web file manager via helper + path/symlink checks | SFTP + API file endpoints | Troxe better validation, lacks SFTP | SFTP users requested for hosting | Add SFTP or API/SSH access tool |
| Console | socket.io `ExecGateway` interactive `/bin/sh` exec shell | Process attach to runtime stdin/stdout/stderr | Different console fidelity | Troxe shell is container shell, not actual app console | Consider attach process |
| Backups | auto daily backup and restore logic present | local/S3, restore, transfer | Different transport and scheduling | Restore failures can damage data | Ensure restore tests and atomicity |
| Recovery | Reconciler and crash-loop detection | Panel-driven config reset, reattach persistence | Troxe recovery code substantial | Race after backend restarts possible | Integrate tests for restart/reconciliation |
| Garbage collection | Label-based with grace window | likely manager-local | Troxe handles orphan cleanup | Prevents leaks | Keep |
| Template extensibility | Template definitions and install/build preludes | Panel eggs / configs (concept) | Troxelow tests constrain path and security | Strong candidate to retain | Keep; harden template parser |
| SFTP | absent in backend reviewed | built-in | Missing major usability feature | Potential impact business/service | Evaluate separately |
| Documentation/operator UX | Node setup and TLS likely custom | config and setup commands | Need bootstrap reproducibility | Mitigates config drift | publish native installation scripts |
| Agent versioning | Centralized API can upgrade; node Docker and host isolation need automation | Agent binary lifecycle | No single agent to update; host script drift risk | Security hardening updates rely on manual update | Node bootstrap version check |
| Multi-tenant isolation | Strong design, including helpers and DB ownership | Strong container security + read-only rootfs | both strong in different places | Safety still depends on production setup | Verify against HostConfig |
| Audit logs/support/pricing | Troxe full platform includes these, Wings narrower scope | Not comparable | Scope difference | N/A | Not relevant to agent design |

## 7. Confirmed Missing Features in Troxe relative to Wings

1. Standalone per-node architecture with local daemon health semantics.
2. Native automated curl/panel registration typical setup.
3. Console attach directly to server process stream, not shell.
4. SFTP server mode including panel credentials.
5. Wings-style built-in outgoing-IP isolated networks for forced bound traffic (though this may be optional and could violate isolation goals).
6. Self-managed agent binary upgrade strategy.
7. Agent-side transfer/binary backup flow scale (could rely on backend).
8. Agent-local filesystem permission/quota engine similar to ufs.

## 8. Security Findings (finding types only when evidence-backed)

- Evidence-backed strengths:
  - `FilesService` enforces path normalization, truncation limits and contains against symlink escapes.
  - `PortsService` uses DB-level conflict strategy to avoid duplicate.
  - `ProvisionerService` validates allowlisted images (`IMAGE_NOT_ALLOWED`).
  - local hardening is fail-close (`HARDEN_NETWORK` + production) while creating network.
- Need verification, not assumed weakness:
  - destruction rollback cleans port only under correct caller path? `releaseAll` warns only trust caller. Need targeted tests around delete/reconciler race.
  - remote `isolationOk` returns fail-open behavior if firewall verification cannot read rules, to avoid blocking fleet. This is intentional operational tradeoff but should be documented.
  - remote TLS configuration: Dockerode likely verifies TLS cert but source only passes CA, cert, key (`node-pool.service.ts`). Ensure API-host check and CRL behavior. This must be verified before increasing cross-node trust radius.
  - server ID ownership checks: reviewed policy tests, but full route HTTP references not exhaustively traced. Use existing `resource-policy` tests, and HTTP gateway should be audited separately.
  - Docker backend compromise: by design, host Docker daemon creates container. Strong containment depends on `sandbox.ts` HostConfig (not fully included in this report).
- No confirmed exploit submitted because none was executed. They are potential hardening questions, not vulnerabilities.

## 9. Reliability and Recovery Findings

- Troxe’s `ReconcilerService` is substantial relative to Wings: status sync, ports sync, orphan GC, node down handling, crash-loop detection and auto backup.
- But recovery state is partly in-memory:
  - `restarts` crash-loop counters reset when backend process restarts.
  - Timer-based loops reset on restart.
- Reconciliation uses Docker availability; unreachable nodes are skipped but process remains healthy.
- Crash-loop threshold: 3+ restarts within roughly 130 seconds, then stop.
- Error cases include failed Docker creation with rollback only for resources created in that provision. This is good, but transactionality between DB port rows and Docker robustness needs test coverage.
- Wings similarly depends on local crash handling and attached stream behavior, and reattaches up to 3 times before terminating runaway process.

## 10. Multi-tenant Isolation Analysis

- Troxe has notable isolation engineering:
  - per-server Docker networks
  - iptables hardening
  - firewall drift verification
  - helper container indirection for risky commands
  - ownership docs per volume.
- Wings relies on stronger process security:
  - read-only rootfs
  - cap drops
  - `no-new-privileges`
  - User mode rooted in system UID
  - allocation/network policy.
- Real isolation is not just listed features:
  - remote node script setup can produce drift
  - firewall not centralized in code unless host setup maintained
  - local firewall changes through node manual commands can be invisible in some cases
- The is a mature and partially tested stack but must not assume defense by design alone. It has test files such as `hardening.test.ts`, which should be complemented with a live network isolation integration test eventually.

## 11. Ports and Networking Analysis

- Troxe port allocator:
  - random rotating start
  - user allocation history
  - unique index arbiter
  - release marker instead of deletion.
  - `PortsService.releaseWhenUnbound` only releases atomically after verifying unbound.
- Wings:
  - binds host ports from known panel allocations.
  - uses per-network configuration for force-outgoing IP.
- Troxe has health vectors distinguishing published vs listening vs host-reachable. This is operationally useful and more mature than simple DB presence.
- The only concern is that remote node and backend API need clear authorization and anti-repeat behavior. Under reviewed authorization system generally appears strong; definitive route matrix review remains required.

## 12. Docker and Resource Management Analysis

Troxe:
- Central Docker volume/naming:
  - `resourceNames` deterministic naming: `srv_`, `net_`, `vol_`.
- Persistent volume ownership repaired before every container create.
- Starter files only on empty volume.
- Backup and restore path handling.
- Disk checks through helper, bounded log sizes.
- Host resource parser for `df -P`.
- Triggers crash loop and offline states in reconciler.

Wings:
- Docker local abstraction encapsulates attach streams.
- `InSituUpdate` updates limits without recreating.
- Container power start/stop.
- read-only rootfs and strong caps.
- tmpfs `/tmp`.
- image pulls and fallback errors.

Conclusion: Troxe’s scale of per-server isolation is operationally heavy but useful; Wings has cleaner container security defaults.

## 13. Template and Runtime Architecture

- Troxe template system is one of notable differentiators:
  - execution definitions in `templates/*`
  - updated step compilation
  - support for package/build command variants.
  - image allowlist (`runtimeImage`, `resolveRuntimeImage`).
- Risks to mitigate:
  - avoid command injection in templates.
  - validation unit tests exist (`template-security.test.ts`).
  - review all step compilers.
- Wings likely relies on Panel-defined configuration (“server config”) rather than local pree.
- For Troxe’s advertised Node/Python/Discord bots/Web apps/APIs/game runtime landscape, decoupling template definitions from container machinery is the correct direction.
- Recommend event-based runtime policy adapter:
  - template validates startup and dependencies
  - runtime manager launches container with limits
  - plugins don’t get to alter cgroup/network defaults.

## 14. Licensing Considerations

- Wings reviewed at MIT license:
  - copyright and license notice must be preserved if recipients copy substantial portions.
  - commercial use and modification explicitly permitted if retained.
  - source heading must remain in any copied source.
- Do not treat resolved architecture ideas (for example Panel-agent topology) as licensable. Code itself is.
- A future fork/absorption of Wings implementation requires dependency license review of the full Go module graph and qualifies beyond this audit.
- Troxe repository root did not show a license file; legal review is still needed for product distribution terms.
- If Troxe chooses to adopt implementation, retain an exact manifest:
  - source commit
  - changed files
  - patch provenance
  - dependency licenses
- Legal validity for derivative distribution is a legal question for counsel; this audit cannot make definitive legal conclusion on ambiguity.

## 15. Recommended Architecture

Selected options:
- Option A: continue developing current Troxe Node model.
  - Pro: fastest route to production stability, leverages current APIs, DB and tests, and specific Troxe isolation.
  - Con: central agent controls Docker for all nodes, and remote network / hardening setup heterogeneity.
- Option B: modify/fork Wings.
  - Pro: directly gains mature console/SFTP/backup/runtime semantics.
  - Con- Con: different control plane model, significant Go work, panel-state dependency, and operational changes at every node.
- Option C: independent Troxe Node Agent.
  - Pro: strongest fit to Troxe backend, no forced project abandonment, selective equivalent of Wings without forced Pterodactyl semantics.
  - Con: full engineering effort, but can be phased safely.

Recommendation: Option C implemented as a phased, incrementing refactor.  
Rationale:
- Troxe already has valuable isolation and allocation systems that are not trivial in Wings.
- Provider goals differ: Troxe hosts general workloads, Node/Python/bots/APIs/static/many domains; Pterodactyl’s game server orientation is useful but not mandated.
- There are no confirmed security holes requiring full rewrite. Most documented risks are incomplete integration testing.
- A new lightweight agent (or direct protocol) can initially support status and exec only, then SFTP and backups.

## 16. Prioritized Remediation Plan

Phase 1 – security first:
1. Verify remote Dockerode TLS certificate validation settings with reproducible config test.
2. Confirm `sandbox.ts` Docker HostConfig includes no-new-privileges, caps and readonly rootfs or document lack.
3. Move any caller of `nodePool` to ensure server ownership validation.
4. Test rollback path around `releaseAll` / DB receipt race with integration tests.
5. Record a node bootstrap script version, and require confirmation that:
   - firewall baseline rules are present
   - ports are open or blocked appropriately
6. Consider live integration firewall test before production fleet scaling.

Phase 2 – missing functional support:
1. SFTP or SSH tooling for customers (`sftp/server.go` as reference only).
2. Console attach optimization:
   - current `ExecGateway` provides shell, not server process stdin stream
   - possibly add first-class runtime console endpoint on backend.
3. Expand automated Node setup process as vendored binary/doc.
4. Backup verification and integrity:
  - ensure restore can’t create path traversal
  - test quarantine behavior.
5. Node auto-upgrade mechanism backed through control plane version manifest.

Phase 3 – architecture improvements:
1. Define a `NodeRuntime` interface in NestJS backend rather than direct Docker call flow.
   - methods `provision`, `start`, `stop`, `inspect`, `stats`, `exec`, `fileTransfer`.
2. Implement adapter:
   - LocalDockerAdapter (current)
   - RemoteDockerAdapter (current TLS)
   - Future: TroxeAgentAdapter (optional transition)
3. Expose runtime port policy independently from network script.
4. Add event tracing between backend and runtime operations.

Phase 4 – tests:
- Unit: template path, image security, ports candidate, df parser, runtime image, deps prelude.
- Integration: port duplicate race, release and delete ordering, network hardening, file path, streaming uploads, DB persistence/retry.
- Docker integration: Container creation, boundaries, resource limit.
- Network isolation: live subnet traffic attempts, container-to-container, host.
- Resource enforcement: CPU stress, memory OOM, storage fill.
- Concurrency: locks, provision per node.
- Recovery: start after kill mid-provision and DB/Docker inconsistency, node restart, firewall states.
- Security: ownership IDs, admin agent permission, TLS mismatch.

Phase 5 – migration if optional replacement:
- Deploy agent in isolated environment.
- Validate CPU, RAM, ports, status, file, backup behavior using synthetic workload.
- Verify status contract compatibility back into backend DB.
- Migrate one synthetic server first and verify logs, persistence, restart, and cleanup.
- Keep clear rollback path, including proceeding commit/model.
- Never migrate all customers in a single release.

## 17. Architecture Options Summary (no arbitrary numerical scores)

- Option A development cost Medium-Low; strategic fit High; security leverage Current; risk modest.
- Option B fork cost High; strategic fit medium; potential large runtime advantage but translation complexity and maintenance transfer; risk high.
- Option C new agent development medium-high; strategic fit highest; timeline longer; maximum control eventually high.

Do not interpret these qualitative values as arbitrary score ranks. If governance requires quantified scores, each score must be tied to implementation evidence and then reviewed.

## 18. Unverified assumptions and remaining questions

- Full sandbox HostConfig in Troxe still needs final review.
- Name server health and DNS behaviors not evaluated.
- static host-based firewall bootstraps and expected version management remain partially code.
- whether `PortsService` release under partial state can be blocked by stdin quotas.
- remote Docker daemon TLS specifics for hostname validation need confirmation.
- Wings dependency security and policy risks not reviewed.
- Frontend effects, permission guardrails, API route to ownership not completely covered.
- hidden assumptions in env and product database schemas important to actual state.

## 19. Final Decision Statement

Troxe should **continue current platform evolution**, particularly the middleware separation and port allocator while elevating:
- node bootstrap standardization
- runtime contract
- test realism
- optional agent architecture design.
Keep Wings as a comparator/design source, not an automatic migration goal.

## 20. Final Gap Table (sorted by operational priority)

| ID | Gap | Troxe evidence | Wings evidence | Impact | Priority | Recommendation |
|---|---|---|---|---|---|---|
| 1 | Node agent-independent daemon | DNS direct Dockerode-based design<|end|> Standard daemon | Operational responsibility difference | High | Keep current; document |
| 2 | SFTP client access | Missing | `sftp/server.go` | customer UX and feature parity gap | High/Med | Optional service |
| 3 | Process console attach | `ExecGateway` shell | `container.go` attach into main stream | Console logs mismatch and crashtools omitted | Medium | Add runtime process console option |
| 4 | Real remote isolation controls | Partial; drift reports | Container security optics | Security and reproducibility gap | High | Bootstrap standardization |
| 5 | New agent bootstrapping | absent | supported by server manager | onboarding friction | Medium | build setup workflow |
| 6 | In-situ resource management | likely Docker update semantics unspecified | `InSituUpdate` | operational flexibility | Medium | implement explicit limits update API |
| 7 | Disk quota enforcement | Usage alerts | ufs quota | compliance with limits may drift | Medium | improve block/quota-level enforcement |
