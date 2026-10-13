# المراجعة الهندسية الثانية — نظام إدارة النود وDocker في Troxe Hosting

**تاريخ المراجعة:** 2026-10-13  
**النسخة المفحوصة:** `fa13773b01b70f2867b4a0fde0800f1df6c496cf`  
**نوع المراجعة:** Read-only engineering audit  
**التصنيف العام:** Confirmed findings / Partially Verified / Unverified / Not Applicable

---

## 1. Executive Summary

المعمارية الحالية صلبة من ناحية **عزل الحاويات وقيود Docker**، لكنها مركّبة حول API واحد يمتلك صلاحية Docker كاملة. لا توجد ثغرة حرجة مؤكدة تُبرّر إعادة بناء النظام من الصفر، لكن هناك مخاطر مهمة في:

1. **`autoRestart` غير مُنفَّذ فعليًا في Docker**؛ السياسة `RestartPolicy.Name = 'no'`، ولم أجد مسار Reconciler يعيد تشغيل السيرفر أوتوماتيكيًا.
2. **إعادة حساب وتحديد CPU/RAM تعتمد على rebuild container**، لا على `ContainerUpdate`، مما يؤدي إلى downtime عند كل تغيير موارد.
3. **حدود storage ليست kernel quota**؛ هي `du` + gate عند الرفع + fence دوري في Reconciler.
4. **أمن النود البعيدة يعتمد بشدة على Docker mutual TLS**؛ الاختراق العملي للمفتاح يعني تحكم Docker كامل على النود.
5. **الاختبارات الحالية قوية على مستوى الوحدات والمنطق**، لكنها لا تكفي لإثبات العزل الشبكي الفعلي، سلوك OOM/CPU/PIDs، أو استعادة الحالة بعد إعادة التشغيل.

**التوصية المعمارية:**  
اعتماد **الخيار B: فصل طبقة `NodeRuntime` داخل Backend بدون Agent مستقل حاليًا**.  
إعادة بناء Agent مستقل غير ضرورية الآن، ويجب تأجيله حتى تظهر متطلبات قاطعة مثل بيئات Managed Multi-Tenant، أو نود لا يمكن للـ Backend الوصول إليها إلا عبر Agent، أو الحاجة إلى وحدة تفريغ OFF-host للـ Docker socket.

---

## 2. Confirmed Findings

| # | Finding | التصنيف | الدليل |
|---|---|---|---|
| F1 | الحاوية الأساسية تستخدم restrictive policy قوية: `ReadonlyRootfs=true`، `Privileged=false`، `CapDrop=['ALL']`، `no-new-privileges`، private IPC/PID/cgroup namespaces. | Confirmed | `backend/src/modules/servers/provisioning/sandbox.ts:228-279` |
| F2 | الصورة مقيّدة بـ digest allowlist؛ لا يمكن للمستخدم تمرير image عشوائي. | Confirmed | `backend/src/modules/servers/provisioning/images.ts:326-347`، `backend/src/modules/servers/provisioning/provisioner.service.ts:205-217` |
| F3 | الحاوية تعمل كـ numeric uid `1000:1000` لكل runtimes مدرجة. | Confirmed | `backend/src/modules/servers/provisioning/sandbox.ts:345`، `backend/src/modules/servers/provisioning/images.ts:354` |
| F4 | PID/CPU/RAM/log limits مفروضة على مستوى Docker host config. | Confirmed | `backend/src/modules/servers/provisioning/sandbox.ts:253-272` |
| F5 | لكل سيرفر شبكة Docker مخصّصة وvolume مخصّص، والحاوية لا ترى `docker.sock`. | Confirmed | `sandbox.ts:229-235`، `provisioner.service.ts:227-282` |
| F6 | `autoRestart` لا ينفّذ سياسة Docker restart ولا يوجد Auto-Start من Reconciler. | Confirmed | `sandbox.ts:277`؛ `servers.service.ts` يمرّر `autoRestart` إلى provisioner فقط، لا يقرأه `buildSandboxConfig` كسياسة restart |
| F7 | rescale لـ CPU/RAM يعيد بناء الحاوية، لا ينفّذ Docker in-place update. | Confirmed | `servers.service.ts:1057-1156` |
| F8 | Storage quota تُقاس عبر `du` داخل helper، وليس عبر block quota حقيقية. | Confirmed | `backups.service.ts`، `reconciler.service.ts:439-457`، `provisioner.service.ts:266-290` |
| F9 | Docker remote يتطلب CA/cert/key؛ لا fallback إلى plain HTTP. | Confirmed | `node-pool.service.ts:100-111`؛ `node_modules/docker-modem/lib/modem.js:118-122` |
| F10 | في dev فقط، إذا كان Docker غير متاح يتم تسجيل السيرفر بدون container. | Confirmed | `provisioner.service.ts:189-207` |
| F11 | API المحلي يملك Docker socket عبر mount، ويستخدم `network_mode: host` + `NET_ADMIN`. | Confirmed | `backend/Dockerfile:9-24`، `docker-compose.prod.yml:28-43` |
| F12 | اختبارات الوحدات تغطي sandbox env وtemplates وports ومنطق hardening، لكن لا تغطي live Docker host enforcement. | Partially Verified | `backend/test-unit/*`، `backend/test/unit/*`، `backend/test/integration/*` |

---

## 3. Docker Security Review

| الإعداد | الحالة | مكان التطبيق | ملاحظات / المخاطر |
|---|---|---|---|
| Privileged | ✅ Disabled | `sandbox.ts:242` | لا يوجد مسار يفعّله. |
| Capabilities | ✅ Drop ALL | `sandbox.ts:243-244` | لا `CapAdd` للحاويات العادية. |
| no-new-privileges | ✅ Applied | `sandbox.ts:245` | يمنع escalation عبر suid/sudo داخل الحاوية. |
| Read-only rootfs | ✅ Applied | `sandbox.ts:231` | `/data` فقط قابل للكتابة. `tmpfs` لـ `/tmp` و`/run`. |
| User | ✅ numeric uid | `sandbox.ts:345` | كل runtimes `1000:1000`. |
| Docker socket | ✅ Not mounted to user containers | `sandbox.ts:229-235` | API فقط يملكه. |
| Network mode | ✅ Private network | `sandbox.ts:230` | لا host mode للحاويات العادية. |
| PID limit | ✅ Applied | `sandbox.ts:258`، `env.ts:398` | الافتراضي 512. |
| Memory limit | ✅ Applied | `sandbox.ts:255-257` | `MemorySwap=Memory` يقلل مخاطر OOM الناتجة عن swap. |
| CPU limit | ✅ Applied | `sandbox.ts:253-254` | `NanoCpus` يفرض حدًا صارمًا. |
| Storage limit | ⚠️ Not kernel quota | `files.service.ts`، `reconciler.service.ts:439` | `du` + periodic stop. |
| Process/IO fairness | ⚠️ Limited | Host config | لا `blkio`، ولا CPU pinning، ولا network I/O limiting. |
| Restart policy | ⚠️ Intentionally `no`، لكن فجوة `autoRestart` | `sandbox.ts:277` | قد لا يلبي توقعات العملاء. |
| Logs | ✅ Bounded | `sandbox.ts:272` | 10MB × 3 files. |
| Devices | ✅ None | `sandbox.ts:246-247` | لا device access. |
| Bind mounts | ✅ Only server volume | `sandbox.ts:229` | helpers تستخدم bind خاص للملفات. |
| Resource update | ⚠️ Rebuild، not in-place | `servers.service.ts:1136-1144` | Downtime عند التغيير. |
| Helper containers | ⚠️ Strong but privileged-ish | `docker.service.ts:660-712`، `docker.service.ts:315-341` | Network-none، cap drop، no-new-privileges؛ لكن `readHostIptables` يضيف `NET_ADMIN` + `SYS_CHROOT` + host netns. الصورة مثبّتة digest، لكنها نقطة ثقة مركزية. |

### تقييم عام

قيود الحاوية الواحدة قوية. المشكلة ليست في إعدادات الحاوية، بل في:

- مركزية Docker socket في API.
- عدم وجود enforcement حقيقي للتخزين.
- عدم وجود update live للموارد.
- اعتماد قوي على helpers.
- فجوة `autoRestart`.

---

## 4. Remote TLS Review

### Confirmed

- عند تسجيل عقدة remote، يجب تمرير CA + client cert + client key.
- لا يمكن حفظ TLS جزئي عند التحديث؛ النظام يرفض `ca/cert/key` غير مكتملة.
- المفاتيح تُشفّر قبل تخزينها.
- عند إرجاع العقدة للـ admin يتم حذف TLS من الاستجابة واستبداله بـ `hasTls`.
- Dockerode/docker-modem يستخدم `key/cert/ca`، وبالتالي يتحول البروتوكول إلى HTTPS.
- Node TLS default يتحقق من السلسلة والتاريخ. لا توجد `rejectUnauthorized:false`.

### الأدلة

- `NodesService.create`: `backend/src/modules/nodes/nodes.service.ts:163-190`
- `NodesService.update`: `backend/src/modules/nodes/nodes.service.ts:191-250`
- `strip()`: `backend/src/modules/nodes/nodes.service.ts:105-107`
- `NodePoolService.build`: `backend/src/modules/nodes/node-pool.service.ts:88-116`
- protocol switch: `node_modules/docker-modem/lib/modem.js:118-122`

### Riski

1. **Server hostname/SAN verification:**  
   TLS يتحقق من الـ hostname عندما يستخدم Dockerode `host: row.dockerHost`. لكن `node-setup.sh` يضع SAN اعتمادًا على:
   - `hostname -f`
   - `localhost`
   - `127.0.0.1`
   - IPs الممرّرة عبر `NODE_IPS`

   إذا سُجّلت العقدة عبر DNS أو IP غير موجود في `NODE_IPS`، يجب اختبار ذلك في بيئة معزولة. لم أؤكده من Docker daemon logs.

2. **Certificate rotation:**  
   التحديث ممكن عبر admin API، لكن لا يوجد CRL ولا تنبيه قبل انتهاء الشهادة.

3. **Exposure:**  
   إذا شُغّل `ALLOW_OPEN_DAEMON=1`، يتم تعريض منفذ Docker على الإنترنت. غير موصى به.

4. **Compromised client cert = full node compromise:**  
   client cert يملك صلاحية Docker كاملة.

5. **Hostname mismatch خطر deployment حقيقي إذا كان التسجيل IP بدون `NODE_IPS`.**  
   التصنيف: Partially Verified.

---

## 5. Resource Enforcement Review

### CPU

- `cpuMilli` يتم التحقق منه في plan/quota.
- يتحول إلى `NanoCpus` و`CpuShares`.
- `NanoCpus` حد صارم.
- لا CPU pinning.
- rescale يعيد build.

### RAM

- `ramMb` يتحول إلى `Memory` و`MemorySwap`.
- الحد صارم على مستوى kernel/cgroup.
- rescale يعيد build.

### Storage

- `storageGb` قيمة DB.
- تُفحص عند عمليات files فقط.
- Reconciler يقيس دوريًا ويوقف عند التجاوز.
- الفحص يفشل آمنًا فيقرأ الاستخدام؛ لا يمنع الكتابة بطريقة hard quota.

### PIDs / Files / Logs / Network

- `PidsLimit` مفروض.
- `nofile` و`nproc` مفروضتان عبر ulimits.
- Logs محدودة.
- لا egress/ingress bandwidth limits.

---

## 6. Lifecycle and Recovery Review

### Create

- plan + owner lock + insert server.
- port allocation.
- provision.
- start/settle.

**التزامن:**
- per-server mutex: `servers.service.ts:92-102`
- per-node network mutex: `provisioner.service.ts:86-104`
- per-owner backup mutex: `backups.service.ts:60-75`

**نقاط الضعف:**
- إذا نجح Docker لكن فشل persist DB بعد `docker.start`، قد تبقى الحاوية running بدون `containerId` صحيح.
- port release عند فشل create يحتاج اختبارًا.

### Start / Stop / Restart

- `lifecycle()` يعيد قراءة row تحت lock.
- يتحقق من `deleting` وoperable.
- `settled()` يمنع false success.

**نقاط الضعف:**
- لا auto-restart.
- restart يؤدي downtime.

### Delete

- الترتيب: container → ports → DB.
- يمنع release قبل تدمير container.
- قد يترك orphan resource إذا فشل destroy؛ Reconciler يحاول GC.
- قد يترك backup files إذا فشل `rm`.

### Backup / Restore

- restore تحت per-server lock.
- safety backup قبل restore.
- منع symlink escape أثناء extraction.
- يستعيد حالة running السابقة.

**المخاطر:**
- restore ليس transactional؛ قد يترك `/data` جزئيًا.
- safety backup best-effort.
- لا checksum verified archive.

### Recovery بعد Backend Restart

`ReconcilerService`:
- يبدأ بعد 5s ثم كل 60s.
- يزامن DB وContainer.
- يعالج provisioning stuck.
- يعيد hardening.
- ينظف orphans.

**لا يكفي لـ:**
- Docker success + DB failure.
- partial restore.
- port allocation mismatch.

---

## 7. Authorization Review

| المسار | التحقق | التصنيف |
|---|---|---|
| Create server | JWT + plan + owner row + throttle | Confirmed |
| Start/Stop/Restart | JWT + access guard + service checks | Confirmed |
| Delete | Owner guard | Confirmed |
| Runtime change | Owner-only | Confirmed |
| Rescale | Access + service check | Confirmed |
| Files | Access + volumeOf + permission | Confirmed |
| Backups | Access + backup permission | Confirmed |
| Ports | Access + permission | Confirmed |
| Node CRUD | JWT + AdminGuard | Confirmed |
| Exec WS | WS ticket + server access | Partially Verified |

### Riski

1. `accessible()` هو API داخلي قوي؛ أي route ينسى استدعاءه سيصبح ثغرة IDOR.
2. `ServerAccessGuard` لا يمنح صلاحية بمفرده، لكن يجب على كل service التحقق.
3. `ownerId === 'admin'` bypass داخلي؛ يجب ألا يظهر من request.
4. `exec` يحتاج test للتأكد أن ticket لا يُستخدم عبر سيرفرات.

---

## 8. Network Isolation Review

### Local Node

- تخصيص `/24` لكل سيرفر من supernet.
- منع:
  - `169.254.0.0/16`
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
  - `100.64.0.0/10`
- منع الوصول إلى host.

### Remote Node

- supernet firewall عبر `scripts/node-setup.sh`.
- Reconciler يتحقق hourly من `verifySupernet`.
- لا per-sandbox rules على remote.

### Riski

1. **Fail-open عندما تكون القواعد غير قابلة للقراءة.**
2. **وجود firewall script لا يُثبت أنه مطبق فعليًا على كل node.**
3. **لا توجد اختبارات حزم شبكية حقيقية.**

---

## 9. Required Integration Tests

### 9.1 Docker Sandbox Tests

- Privileged=false assertion
- ReadOnlyRootfs write behavior
- no-new-privileges escalation blocked
- Cap drop enforcement
- Docker socket inaccessibility
- PIDsLimit enforcement
- Memory OOM
- CPU cap behavior

### 9.2 TLS Tests

- no CA rejection
- invalid server cert rejection
- expired cert rejection
- wrong SAN hostname rejection
- valid mTLS success
- client key rotation behavior

### 9.3 Network Isolation Tests

- cross-server blocking
- container → API host blocked
- metadata IP blocked
- private ranges blocked
- same-sandbox published port works
- rules reconverge after Docker restart

### 9.4 Resource Tests

- OOM
- CPU enforcement
- storage upload rejection
- in-process over-quota behavior
- noisy-neighbor IO behavior

### 9.5 Lifecycle Tests

- duplicate power operations
- delete during start
- backup/restore concurrency
- restore malicious archive
- backend crash at phase boundaries
- orphan recovery

### 9.6 Authorization Tests

- IDOR attempts
- subuser permission boundaries
- admin bypass misuse
- WS ticket misuse

---

## 10. Architecture Decision

### Option A: Maintain current architecture

- Pros: أقل تغيير، استفادة من الاختبارات الحالية.
- Cons: Docker socket مركزي، `autoRestart` مكسور، تحديث موارد disruptive.

### Option B: Build `NodeRuntime` abstraction inside backend ✅ **موصى به**

يُنشئ interface مثل:

```ts
interface NodeRuntime {
  nodeId: string;
  available(): Promise<boolean>;
  ping(): Promise<boolean>;
  provision(input): Promise<ProvisionResult>;
  destroy(input): Promise<string[]>;
  inspect(id): Promise<ContainerState | null>;
  start(id): Promise<void>;
  stop(id): Promise<void>;
  restart(id): Promise<void>;
  stats(id): Promise<ContainerStats | null>;
  logs(id): Promise<string>;
  runHelper(cmd): Promise<HelperResult>;
}
```

**Pros:**
- فصل Business logic عن Docker.
- سهولة اختبار fault injection.
- يمكن إضافة later remote agent runtime دون كسر controllers.
- لا يحتاج migration.

**Cons:**
- يحتاج refactor محدود.

### Option C: Independent Troxe Node Agent

سبب مشروع إذا:
- لا يمكن للـ Backend الوصول إلى Docker مباشرة.
- تريد multi-region/self-hosted.
- تريد별 access.

لكنه حاليًا يزيد complexity وsurface area.

### Option D: Fork/reuse Pterodactyl Wings

غير موصى به الآن. Troxe يحتاج template system، port allocator، network ownership، billing/plans، backup policies مختلفة. الاستنساخ يعني صيانة ثنائية.

---

## 11. Prioritized Implementation Plan

### Phase 1 — Fix confirmed gaps

1. Fix `autoRestart`.
2. Use Docker in-place update where possible.
3. Strengthen create recovery and orphan cleanup.
4. Improve remote TLS SAN/hostname tests.
5. Add loud fail signal when remote firewall ruleset unreadable.

### Phase 2 — Architecture cleanup

1. Introduce `NodeRuntime`.
2. Move Docker calls into runtime adapters.
3. Make Reconciler runtime-driven.
4. Mock reconciliation/lifecycle in tests.

### Phase 3 — Tests

- Docker sandbox tests
- TLS tests
- Network isolation tests
- Resource enforcement tests
- Lifecycle fault injection
- Authorization IDOR tests

### Phase 4 — Optional Agent

لا تبنِ Agent قبل:
1. توفر `NodeRuntime`.
2. نجاح lifecycle tests.
3. وجود TLS rotation.
4. التحقق من multi-region isolation.

---

## 12. Remaining Unknowns

| # | Unknown | Why important | Suggested verification |
|---|---|---|---|
| U1 | Remote TLS SAN validation with registered host | Connection failure أو trust confusion | isolated Docker daemon + mTLS test |
| U2 | Docker success + DB failure | orphan running container | fault injection |
| U3 | Actual network isolation behavior | logical evaluation قد لا يكفي | live packet tests |
| U4 | Whether `autoRestart` expected by users | UX/reliability | confirm product requirement |
| U5 | Backup/restore atomicity | data integrity | staging restore tests |
| U6 | IO/network fairness under noisy neighbor | reliability | stress test |
| U7 | `readHostIptables` correctness | false positives/negatives | real node reboot test |
| U8 | Container restart behavior for crashed workloads | reliability | integration test |

---

## الخلاصة النهائية

نظام Troxe الحالي جدير بالاستمرار، لكنه يحتاج تقوية قبل توسّع الإنتاج.

القرار الأدق:

> **لا تنشئ Agent مستقل الآن، ولا تعِد بناء النظام. أنشئ طبقة `NodeRuntime` داخل Backend، ثم اختبر lifecycle/network/security بشكل حقيقي. اجعل Agent خيارًا لاحقًا عند وجود حاجة تشغيلية قاطعة.**

أولويات التنفيذ الفورية:

1. Fix `autoRestart`.
2. Fix CPU/RAM update لتقليل rebuild غير الضروري.
3. تقوية create recovery.
4. توضيح TLS verification وhostname matching.
5. إضافة live integration tests للعزل والكوتا والاستعادة.
