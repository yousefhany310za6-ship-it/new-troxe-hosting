# تقرير التدقيق الشامل الثاني — Troxe Hosting
## Security + Reliability + Maintainability + Architecture + Production Readiness

**التاريخ:** 2026-10-02 — **النطاق:** المشروع كاملًا (backend + frontend + deploy + nodes) — **المنهجية:** 5 مسارات تدقيق متوازية + تحقق يدوي من كل ادعاء عالي الأثر (لا findings بدون دليل كود).

## ملحق الإصلاح — STATUS: TOP 8 FIXED ✅ (2026-10-02)

| # | البند | الـ commit | الإثبات |
|---|---|---|---|
| 1 | WS IDOR + CORS | `7cd3dd5` | مهاجم مُنع من قناة الضحية، المالك مقبول، بلا تسريب |
| 2 | Compose deploy | `d659c90` | `docker-compose config` سليم (loopback PG، بلا تعارض شبكات، PORT=3300) |
| 3 | Logout + Settings | `51661cb` | cookie مُسحت + refresh بعده 401؛ build الفرونت |
| 4 | Demotion revocation | `9a1b98b` | توكن المُخفَّض 401 فورًا |
| 5 | Throttle + tail | `85e3a47` | 65x logs→429s، 12x stop→429s (tail مثبّت أصلًا 1..2000) |
| 6 | Dockerfile | `1cf5b17` | صورة 477MB تُبنى، bcrypt/drizzle تُحمَّل، PORT=3300 |
| 7 | Indexes + quota | `1cf5b17` | الفهارس الثلاثة موجودة؛ 3 نسخ متوازية عبر 3 سيرفرات نجحت بلا deadlock |
| 8 | node-setup + misc | `de6c9c7` | رفض بدون API_IP؛ TRUST_PROXY/PG_VERIFY/compose؛ خروج عند rejection |

ملاحظات تدقيق مضادة (false positives المرفوضة أثناء التنفيذ): `tail` مثبّت أصلًا في الخدمة؛ `PG_SSL_REJECT_UNAUTHORIZED` الافتراضي آمن فعلًا (الاسم معكوس — أُعيدت تسميته لـ `PG_SSL_VERIFY`)؛ bcrypt تُحمَّل مع `--ignore-scripts` (prebuilds) — الفحص الجديد يمنع الانحدار بدل إصلاح عطل حي.

## ملحق الإصلاح (2) — ما بعد الـ Top 8 — STATUS: FIXED ✅ (2026-10-03)

| # | البند | الـ commit | الإثبات |
|---|---|---|---|
| 9 | صلاحيات متأخرة: activity للعميل، جدولة auto-backup، retention يسبق الإنشاء | `b549238` | feed + paging، حدود `retain` 400s، التقليم الحيّ إلى 1 |
| 10 | حواجز النشر: ترحيلات عند الإقلاع + SPA تُقدَّم + بناء مثبّت بـ digest | `d3305f7` | API على DB صفر-جداول أنشأ 9 جداول + فهرس 0008؛ idempotent على DB حقيقي |
| 11 | sonar: فحص صحة تنبيهي + إصلاح وثائق النسخ الاحتياطي الميتة | `d0eac7a` | API/PG/قرص/حداثة النسخ/حالة الحاويات؛ تنبيه + كتم 6h مع تعافي |
| 12 | smoke للفرونت (25 صفحة) — **وجد white-screen حقيقي** | `b59be58` | 25/25 خضراء + إثبات عكسي بردّ الخطأ (`<Plus>` بلا import) |
| 13 | Caddy على شبكة المضيف (كان 502 دائمًا لكل استدعاء API) | `55fc51a` | bridge=502 ← host=200؛ SPA fallback 200؛ `/api/*` proxy 200 |
| 14 | فصل مفتاح توكن WS عن مفتاح JWT + اضمحلال إقفال الدخول | `8f0e72c` | توكن WS ≠ HMAC(JWT) وتذاكر السياقات لا تتبادل؛ 5 فشل → تراجع 20د → العدّاد يبدأ من 1 بلا قفل، والهجوم الفعلي داخل النافذة يقفل (429) |
| 15 | سقوف بايتات: streams النسخ + السجلات (مع إصلاح crash حقيقي) | `900e7fb` | نسخة 40MB/سقف 16MB → `413 ARCHIVE_TOO_LARGE` بلا ملف متبقي، ونسخة تحت السقف `201 ready`؛ سطر واحد 5MB → استجابة 4,194,337 حرف بالعلامة؛ وحدة `ulimit -f` مُقيسة = 512B؛ وحدات 5 خضراء |
| 16 | حصة قرص: حارس مكانية العقد + تنبيه القرص لكل عقدة | `8808c83` | `df` حيّ على العقدة = 20% / 45.7GB مطابق للمضيف؛ `DISK_BLOCK_PCT=1` → `507 DISK_FULL` بلا صف في DB؛ الافتراضي 90 → `201` يعود؛ سطر reconciler `node "local" disk is 20% full` |
| 17 | «ثقة عمياء» بالجدار الناري للعقد: تحقق حيّ من القواعد الجارية + رفض مكانية عند الانحراف | `7323751` | قراءة حيّة عبر chroot helper (55 قاعدة من المضيف)؛ baseline `14/14 ok`؛ حذف قاعدة 169.254 (metadata) يقلب `ok=false` ويسرد القاعدة بالاسم؛ التعافي التلقائي بعد 90s و`6/6` عودة؛ حارس القرص ما زال `507/201` بعد إعادة الكتابة؛ وحدات 7 خضراء |
| 18 | سقف حجم وشكل ردود الدامن (عُقدة خبيثة لا تُضخّم ذاكرة الـ API) | (هذا الـ commit) | سجل خام يُقتطع عند 8MB **قبل** فك الإطار + إعادة مزامنة على الإطار التالي: تدفّق 12MB يعود `4,194,337` حرفًا وبلا بايت إطار واحد؛ وحدات 9 خضراء (هياكل الإطار/المزامنة/الحدود)؛ فيض console ‏64MB/s → علامة `paused` ثم إغلاق `output-flood` بعد 3 نوافذ بإحالة **12.5MB فقط** عبر 990 إطارًا والـ API سليم؛ وأرقام `stats` finita، و`lastError`/status/نسخة العقد/الشبكة محدودة قبل التخزين أو الإرسال |

تصحيحات جانبية كشفها العمل نفسه: قراءة ملف ناقص أثناء الاستعادة كانت تُطلق `error` غير معالَج **وتسقط العملية كاملة** (أُصلحت + فحص سلامة `bytes === size`)، ومؤقّت الـ 30 دقيقة لكل stream كان يُبقي العملية حيّة بلا داعٍ (يُلغى الآن)، وقيمة `BACKUP_MAX_MB` تحت الحد الأدنى (16) أُسقطت الإقلاع برسالة واضحة — أي أن التحقق المانع للإعدادات يعمل فعلًا.

## Executive Summary

المشروع تحسّن جذريًا منذ تدقيق 2026-09-29: العزل متقارب، الإبطال فوري، والمسارات المدمرة محمية. **لا يوجد أي ثغرة CRITICAL مؤكدة** (لا RCE، لا تجاوز مصادقة، لا استيلاء حسابات). لكن ظهرت **5 مشاكل HIGH حقيقية** — أخطرها: WS realtime يسرب حالة سيرفرات الآخرين لأي مستخدم، وملف الـ compose للإنتاج **مكسور architecturally** (الـ API لن يصل لقاعدة البيانات)، وزر Sign out لا يبطل الجلسة فعليًا، وصفحة Settings معطلة بخطأ runtime، والأدمن المُخفَّض يحتفظ بصلاحياته حتى انتهاء التوكن. الباقي بنود MEDIUM/LOW مشروعة، أغلبها صلابة إنتاج (throttling، indexes، deploy) وليست اختراقات.

## Overall Risk

الخطر الأمني المباشر **متوسط-مرتفع** بسبب بندين قابلين للاستغلال الفعلي (WS IDOR + بقاء الجلسة بعد الخروج)، والخطر التشغيلي **مرتفع** لسبب واحد: نشر الـ compose الحالي لن يعمل من أول `deploy.sh`. بدون هذين، الوضع صلب.

## Critical Findings

**لا يوجد.** فتشت عن RCE/takeover/bypass بمسارات كاملة ولم أجد سلسلة قابلة للاستغلال: الـ digest allowlist مطبق فعلًا عند الـ provision، الـ ownership يُفحص مرتين، والـ refresh rotation ذري مع كشف إعادة الاستخدام.

## High Findings

### [HIGH] تسريب حالة سيرفرات المستأجرين عبر WebSocket — CONFIRMED
- **Location:** `backend/src/modules/auth/realtime.gateway.ts:131-143` + `111-123`
- **المشكلة:** `isAllowedChannel` تقبل أي قناة `server:stats|logs|status:{id}` بدون فحص ملكية، والتعليق يدعي أن "التحقق عند البث" لكن دوال البث ترسل عميانيًا (`this.server.to(channel).emit`). القناة الوحيدة المربوطة اليوم هي `server:status` (تُبث من `servers.service.ts` عند كل تغير حالة).
- **السيناريو:** مستخدم يحصل على ticket خاص به، يشترك في `server:status:{id-الضحية}`، فيرى متى يعمل/يتوقف/يفشل سيرفر الضحية. ولو رُبطت `logs/stats` مستقبلًا بدون إصلاح — تصبح سرقة logs كاملة.
- **Impact:** كشف معلومات عبر المستأجرين + استطلاع للهجمات.
- **Recommended Fix:** فحص الملكية في `handleSubscribe` عبر استعلام مباشر (بدون اعتماد دائري).

### [HIGH] نشر الإنتاج مكسور: الـ API لن يصل Postgres — CONFIRMED
- **Location:** `docker-compose.prod.yml:7-23,35,44`
- **المشكلة:** الـ API يعمل بـ `network_mode: host` ويتصل بـ `127.0.0.1:5432`، لكن Postgres في شبكة `troxe-internal` **بدون `ports` منشورة** — لا يوجد مسار شبكة بينهما أصلًا.
- **السيناريو:** أول `deploy.sh` على سيرفر نظيف → فشل readiness (`select 1`) → حلقة إعادة ثم `migrate` فاشلة.
- **Impact:** الإنتاج غير قابل للنشر بهذا الملف.
- **Recommended Fix:** نشر بورت Postgres على loopback مع إبقاء الـ API على host-network.

### [HIGH] زر Sign out لا يبطل الجلسة — CONFIRMED
- **Location:** `src/context/AuthContext.jsx:49` + `src/lib/api.js:90` + `backend/src/modules/auth/auth.controller.ts:75`
- **المشكلة:** الكود ينادي `apiGet('/auth/logout', {method:'POST'})` لكن `apiGet` **يفرض GET دائمًا** (`{...options, method:'GET'}`)، والباكند يستقبل `POST` فقط → 404، والـ cookie الـ httpOnly تبقى صالحة حتى انتهائها.
- **السيناريو:** مستخدم يضغط خروج على جهاز مشترك مطمئنًا، وجلسة الـ refresh تبقى قابلة للإحياء الصامت.
- **Recommended Fix:** `apiPost('/auth/logout')` + اختبار دورة خروج/دخول.

### [HIGH] صفحة Settings معطلة كليًا — CONFIRMED
- **Location:** `src/pages/dashboard/Settings.jsx:1,60`
- **المشكلة:** الملف يستورد `{useRef,useState}` فقط بينما يستخدم `useEffect` — `ReferenceError` عند أول render. (الـ build لا يكشفها؛ esbuild لا يفحص الأسماء.)
- **Impact:** أي مستخدم يفتح Settings يحصل على صفحة ميتة — وتغيير كلمة المرور/حذف الحساب غير متاح من الواجهة.
- **Recommended Fix:** إضافة الـ import + اختبار render لكل صفحة (smoke test).

### [HIGH] الأدمن المُخفَّض يحتفظ بصلاحياته حتى انتهاء التوكن — CONFIRMED
- **Location:** `backend/src/modules/auth/jwt.guard.ts:58-63` + `backend/src/modules/admin/admin.service.ts:157-175`
- **المشكلة:** الـ role يُؤخذ من الـ JWT claim ولا يُعاد جلبه، و`updateUserRole` لا ترفع `tokenVersion`. توكن وصول (حتى 15 دقيقة افتراضيًا) يبقى admin بعد التخفيض.
- **السيناريو:** تخفيض أدمن خبيث نشط → 15 دقيقة إضافية من `/admin/*` الكامل.
- **Recommended Fix:** رفع `tokenVersion` عند تغيير الدور (إبطال فوري لكل التوكنز).

## Medium Findings

### [MEDIUM] معاملات `logs?tail=` غير محدودة وبلا throttle — CONFIRMED
`backend/src/modules/servers/servers.controller.ts:115` — `ParseIntPipe` فقط. `tail=-1` أو `999999999` تُحمَّل في ذاكرة الـ API لكل request.

### [MEDIUM] فجوات throttle على طرق مكلفة — CONFIRMED
`start/stop/restart` (مع فحوصات 10 ثوانٍ)، `stats/usage/logs/backups`، كل `users/*` و`admin/*`، و`POST /ws/token` — كلها على العام 300/دقيقة فقط (داخلي per-process).

### [MEDIUM] حصة مساحة النسخ TOCTOU عبر السيرفرات — CONFIRMED
`backend/src/modules/servers/backups.service.ts:100-120` — القفل على صف السيرفر يحمي التزامن على نفس السيرفر، لكن المجموع البايتي للمالك يُقرأ بدون قفل مالك + `sizeBytes` تبقى NULL حتى انتهاء الـ tar.

### [MEDIUM] فهارس ناقصة على مسارات ساخنة — CONFIRMED
لا index على `servers.node_id`، ولا على `backups(type,server_id)` و`audit_logs(target)` و`server_events.actor_id`.

### [MEDIUM] لا حصة قرص للحاويات — CONFIRMED
لا `StorageOpt/DiskQuota` في `sandbox.ts`؛ السياج ساعي وأفضل جهد. مستأجر واحد يملأ قرص الهوست ويجوّع الباقين.

### [MEDIUM] تقسية الشبكات المعاد استخدامها + ثقة عمياء بالـ static البعيد — CONFIRMED
إعادة البناء على شبكة موجودة لا يعيد تطبيق القواعد، وعقد الـ remote بلا أي تقارب من الـ API.

### [MEDIUM] سكربت إعداد العقد يطبع المفتاح الخاص + API_IP اختياري — CONFIRMED
`scripts/node-setup.sh:131-132` تطبع `client-key.pem` على الشاشة، وتقييد البورت على IP الـ API تحذير فقط، و`daemon.json` يُكتب فوق الموجود بدون نسخة.

### [MEDIUM] أساس Dockerfile غير مثبت + منفذ مُصعَّد + bcrypt قد لا يُبنى — CONFIRMED
`node:22-bookworm-slim` بدون digest، و`EXPOSE 3300` + healthcheck على 3300 بينما افتراضي `PORT=3000`، و`--ignore-scripts` قد يتخطى بناء `bcrypt`.

### [MEDIUM] إقفال الحسابات بلا اضمحلال — CONFIRMED
6 محاولات فاشلة متباعدة زمنيًا تُقفل الحساب (DoS بطيء بالرش).

### [MEDIUM] ثقة عمياء في ردود الدامن + بث غير محدود الحجم — CONFIRMED
لا تحقق من حجم/شكل ردود الدامن (rogue node تضخم الذاكرة)، ولا سقف بايتات على streams النسخ.

### [MEDIUM] `unhandledRejection` لا تُسقط العملية — CONFIRMED
`main.ts:18-20` تكتفي بالتسجيل — العملية تكمل بحالة مجهولة الفساد.

### [MEDIUM] `TRUST_PROXY=false` خلف Caddy — CONFIRMED
كل العملاء يظهرون `127.0.0.1`: الـ rate-limit والتدقيق وسجل الدخول كلها مشوهة.

### [MEDIUM] `PG_SSL_REJECT_UNAUTHORIZED` افتراضي false — CONFIRMED
TLS مشفر بدون توثيق لـ Postgres المدارة — MITM في مسار الشبكة.

## Low Findings (مؤكدة، مختصرة)

- توكن WS قابل لإعادة التشغيل 30 ثانية ولا يعرف الإبطال/الحذف — LOW.
- `@UseGuards(WsAuthGuard)` ديكور ميت (ليست `CanActivate`) — LOW.
- سلسلة `'admin'` السحرية في `requireOwned` — غير قابلة للوصول اليوم، LOW.
- تغيير البريد لا يدير `tokenVersion` — LOW.
- تعداد البريد عبر signup — مقايضة موثقة، LOW.
- login-CSRF بلا توكن (`SameSite=Lax` فقط) — LOW.
- WS CORS `*` مع credentials — LOW.
- `WS_TICKET_SECRET` يسقط على سر الـ JWT صامتًا — LOW.
- Zip symlink يفلت من الفحص المسبق (الـ sweep يمسكه) — LOW.
- تسرب helpers الميتة + تثبيت orphan عبر العقد (اتجاه آمن) — LOW.
- تدوير الصور قد يعطل reinstall القديم — LOW.
- exec بلا سقف إخراج + حدود داخل العملية فقط — LOW.
- مخرجات xterm تفسَّر ANSI من مدخلات المهاجم — LOW.
- اسم ملف التنزيل من رأس غير موثوق — LOW.
- سقوف العميل تُتجاوز من devtools (الباكند يفرض) — LOW.
- `update` بلا فحص returning فارغ → 500 — LOW.
- فجوة `lockedUntil` بين الزيادة والكتابة — LOW.
- `.dockerignore` لا يغطي `.env.*` — LOW.
- `ALLOWED_ORIGINS` ميتة في compose — LOW.
- Impersonation ميت يبني صفًا غير متوافق — INFO.
- God services + قيم سحرية + تحقق CIDR مكرر — صيانة LOW/INFO.
- DevTools في إنتاج الفرونت — LOW.
- avatar "يُحفظ" وهو لا يُرسل أصلًا — LOW.
- مفتاح TLS في الذاكرة + pool يكاشي null — LOW.
- PEM يُتحقق substring فقط — LOW.
- تداخل supernet عبر طلبين متزامنين (admin فقط) — LOW.
- thundering herd على `pickNode` — LOW.
- BCRYPT_ROUNDS=10 مسموح إنتاجيًا — INFO.
- تبعيتا vite/esbuild (dev فقط) — LOW.
- Signup enumeration / lockout oracle — موثقة، LOW.

## Informational (تصميم سليم موثق)

تعداد البريد، غياب decay، حدود in-process، WS ticket قصير — كلها قيود نسخة-واحدة موثقة. فحص الملكية المزدوج، `tokenVersion`، تدوير الـ refresh الذري، تعمية الأخطاء، تطابق الترحيلات — نقاط قوة حقيقية.

## Production Risk Map

| Area | Finding | Severity | Confidence | Production Impact |
|---|---|---|---|---|
| WS realtime | cross-tenant status leak | HIGH | CONFIRMED | استطلاع + تسريب |
| Deploy | compose network broken | HIGH | CONFIRMED | الإنتاج لا يُنشر |
| Sessions | logout لا يبطل | HIGH | CONFIRMED | جلسات خالدة |
| Frontend | Settings crash | HIGH | CONFIRMED | صفحة ميتة |
| AuthZ | demotion لا يُبطل | HIGH | CONFIRMED | 15 د صلاحيات |
| API | logs tail بلا حد | MEDIUM | CONFIRMED | استنزاف ذاكرة |
| API | throttle gaps | MEDIUM | CONFIRMED | إغراق العمليات |
| Quota | backup space TOCTOU | MEDIUM | CONFIRMED | تجاوز السقف |
| DB | indexes ناقصة | MEDIUM | CONFIRMED | تدهور مع النمو |
| Isolation | بلا disk quota | MEDIUM | CONFIRMED | ملء القرص |
| Nodes | static firewall بلا تقارب | MEDIUM | CONFIRMED | drift صامت |
| Deploy | node-setup key print | MEDIUM | CONFIRMED | تسريب مفاتيح |
| Reliability | unhandledRejection | MEDIUM | CONFIRMED | حالة فاسدة |
| Observability | TRUST_PROXY | MEDIUM | CONFIRMED | forensics عمياء |
| DB | PG TLS بلا توثيق | MEDIUM | CONFIRMED | MITM محتمل |

## Architecture Findings

| Problem | Current | Risk | Recommendation |
|---|---|---|---|
| كل الضمانات in-process | locks/throttle/singletons | تنكسر بأول replica ثانية | Redis للـ throttle/locks أو توثيق "نسخة واحدة" كقيد معماري |
| ثقة كاملة بالدامن | بلا bounding للردود | rogue node يضرب الـ API | حدود حجم/شكل على (version/state/labels/logs) |
| تغطية remote = static فقط | بلا تحقق | drift صامت | فحص دوري عبر helper على العقدة نفسها |
| bind-mount محلي مقابل streams بعيدة | مساران | انحراف سلوكي | اختبار عقدة بعيدة في CI (dind) |
| God services (~700 سطر) | Servers/Docker/Backups | blast radius واسع | تقسيم تدريجي |

الـ Monolith نفسه **مناسب تمامًا** لهذا الحجم — لا أنصح بأي تفكيك.

## Maintainability Findings

- الأكثر تعقيدًا: `servers.service.ts` (~734)، `docker.service.ts` (~644)، `backups.service.ts`، `files.service.ts`، `reconciler.service.ts`.
- دين تقني حقيقي: **صفر unit tests**، magic timeouts مبعثرة، تباين 404/400 للـ UUID.
- لا كود ميت مؤثر، ولا تبعيات دائرية.

## Production Readiness

- Security: [x] إصلاح الـ 5 HIGH — [x] throttle للطرق المكلفة — [x] حدود WS/filenames — [x] لا أسرار في الريبو — [x] صفر ثغرات تبعيات باكند
- Reliability: [x] إسقاط العملية عند rejection غير معالَج — [x] فهارس hot paths — [x] disk quota أو مراقبة قرص — [x] إصلاح compose
- Performance: [x] حد `tail` وصفحات الأدمن — [ ] pool sizing مقابل reconciler — [x] تجمع 8-way
- Observability: [x] `TRUST_PROXY` خلف Caddy — [x] request IDs + health + tick logs
- Deployment: [x] تثبيت أساس Dockerfile — [x] توحيد PORT/healthcheck — [x] إصلاح bcrypt build — [x] node-setup (مفتاح/SAN/API_IP)
- Testing: [x] smoke renders للفرونت (25 صفحة) — [x] unit للمنطق الخالص (9 مجموعات) — [x] تكاملية 88
- Daemon trust: [x] سقوف بايت على كل ما يُقرأ من العقد (سجل/نسخ/استعادة/console) — [x] أرقام ونصوص محدودة الشكل — [x] تحقق حيّ من قواعد الجدار الناري

## Attack Surface Map

`User → Frontend` (XSS معدوم، CSRF منخفض، DevTools) → `API edge` (CORS سليم، throttle ناقص، JSON 4MB) → `Auth` (سليم، عدا demotion/enumeration/lockout) → `AuthZ` (**WS IDOR**، admin سليم، ownership مزدوج) → `Objects` (files/backups containment سليم، zip gap صغير) → `Daemon` (**node rogue غير محدود**) → `Host` (iptables محلي سليم، بعيد static) → `Deploy` (**compose مكسور**، أساس غير مثبت، مفاتيح تُطبع).

## Top Priority Fixes (بالترتيب، مع السبب)

1. **WS IDOR** — التسريب الوحيد العابر للمستأجرين؛ إصلاحه سطر فحص ملكية واحد.
2. **Compose deploy** — لا إنتاج أصلًا بدونه؛ إثبات بـ `deploy.sh` نظيف.
3. **Sign out + Settings crash** — سلامة الجلسات + صفحة كاملة ميتة؛ إصلاحان صغيران.
4. **Demotion revocation** — سطر `tokenVersion` واحد يغلق نافذة 15 دقيقة.
5. **`tail` clamp + throttle الطرق المكلفة** — يغلقان أرخص DoS.
6. **Dockerfile (digest + PORT + bcrypt)** — يمنع مفاجآت البناء/التشغيل.
7. **Indexes + backup quota ذرية** — ديون نمو قبل أن تؤلم.
8. **node-setup + TRUST_PROXY + PG TLS + rejection exit** — صلابة النشر والمراقبة.

## Final Assessment

- **Security Status:** Needs Significant Hardening (خمس HIGH منها اثنان تشغيليان).
- **Production Status:** Not Ready — حصريًا بسبب compose المكسور + Settings الميتة؛ بعد إصلاح الثمانية الأولى: Ready for controlled production.
- **Maintainability:** جيدة البنية، ضعيفة الاختبارات الوحدوية.
- **Biggest Risks:** (1) تسريب WS عبر المستأجرين (2) نشر مستحيل حاليًا (3) جلسات تبقى بعد الخروج (4) صلاحيات أدمن شبحية (5) قرص بلا سقف.
- **Biggest Strengths:** (1) العزل متقارب ومُثبت حيًا (2) الإبطال الفوري عبر tokenVersion (3) تدوير refresh بمستوى جيد فعلًا (4) صفر أسرار/صفر ثغرات تبعيات باكند (5) أخطاء معماة بلا تسريب.
- **Recommended Next Step:** نفّذ Top 8 بالترتيب — كلها صغيرة ومثبتة — ثم أعد تشغيل المجموعة كاملة.
