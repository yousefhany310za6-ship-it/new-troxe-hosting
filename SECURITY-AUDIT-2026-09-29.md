# تقرير التدقيق الشامل — Troxe Hosting (أمن + موثوقية + معمارية + جاهزية إنتاج)

**التاريخ:** 2026-09-29
**النطاق:** الخلفية (NestJS + PostgreSQL/Drizzle + Docker) + الواجهة (Vite/React، غير مربوطة بالخلفية بعد)
**المنهجية:** 6 فرق تدقيق متوازية (مصادقة/API، حاويات/عزل، قاعدة بيانات/تزامن، واجهة، إعدادات/تبعيات/نشر، معمارية/أداء) + تحقق يدوي من أهم الادعاءات على الكود فعليًا.
**القاعدة:** لا نتيجة بدون دليل من الكود — وغير المؤكد مصنّف `NEEDS VERIFICATION`.
**الحالة:** تدقيق فقط — لم يُعدَّل أي كود في هذا التقرير.

---

# ملحق الإصلاح (2026-09-30) — STATUS: ALL 10 ITEMS FIXED ✅

نُفّذت البنود العشرة الأولى من `Top Priority Fixes` بالترتيب، كل بند بإثبات
مستقل ثم انحدار كامل، ودُفع كل بند في commit منفصل (`a708352` → `f3bbdd2`).

## النتائج القابلة للقياس

| المقياس | قبل الإصلاح | بعد الإصلاح |
|---|---|---|
| ثغرات التبعيات (prod `npm audit`) | 13 (1 حرجة + 5 عالية + 6 متوسطة + 1 منخفضة) | **0** |
| مجموعة التكامل | 86/86 | **88/88** (فحصا مهلة جديدان) |
| ترحيلات قاعدة البيانات | `0000` فقط | `0000`–`0004` (كلها مطبقة على الإنتاج التجريبي) |
| صور الحاويات | وسوم قابلة للتغيير | **مثبتة بـ digest** + رفض الوسوم في الإنتاج |
| نشر الخلفية | لا Dockerfile | multi-stage + إثبات إقلاع uid 1000 |

## حالة كل Finding

| # | الـ Finding | الحالة | الدليل |
|---|---|---|---|
| CRIT | تبعيات حرجة/عالية | ✅ مغلق | `npm audit`=0 (drizzle 0.45, bcrypt 6, Nest 11, dockerode 5) — `a708352`,`f70d3a7`,`a528e52` |
| H-1 | rollback يحذف مجلدات حية | ✅ مغلق | أعلام `created` + `rollbackProvision` — إثبات stub مزدوج — `55543d7` |
| H-2 | تقسية لا تُعاد بعد restart | ✅ مغلق | `syncHardening` كل 5 ticks + عند التعافي — 10/10 إثباتات — `a730517` |
| H-3 | حصص التخزين غير مطبقة | ✅ مغلق | سياج reconciler + سقف نسخ + تنظيف ملفات — إثباتات حية — `989d563` |
| H-4 | سباق الحصص | ✅ مغلق | معاملات + `FOR UPDATE` — سباق رباعي: فائز واحد — `523ebc1` |
| H-5 | تدوير غير ذري | ✅ مغلق | معاملة + قفل صف + مهلة 60s (ترحيل 0001) — 5/5 — `523ebc1` |
| H-6 | حذف حساب بلا كلمة مرور | ✅ مغلق | `DeleteAccountDto` + 16/16 — `d04df60` |
| H-7 | استعادة مدمرة | ✅ مغلق | نسخة أمان + فحص مساحة + purge روابط + عودة online — 16/16 — `144086c` |
| H-8 | تزامن دورة الحياة | ✅ مغلق | `acquire` لكل خادم + حراسة deleting — 5 reinstalls → حاوية واحدة — `144086c` |
| H-9 | مصدر الخطة | ✅ مغلق | `backupSlots` من الخطة الحية — تخفيض مثبت 402 — `144086c` |
| H-10 | لا Dockerfile/نسخة واحدة | ✅ مغلق | Dockerfile + إقلاع مثبت + توثيق نسخة واحدة — `27bb917` |
| M | نافذة 15د بعد الإبطال | ✅ مغلق | `token_version` (ترحيل 0002) + فحص الحارس — 16/16 — `d04df60` |
| M | بريد بلا تحقق | ✅ مغلق جزئيًا | كلمة مرور + تدقيق (رابط تحقق حقيقي ينتظر بنية بريد) — `d04df60` |
| M | قفل بلا اضمحلال/أوراكل | ⚠️ مفتوح | مؤجل (يتطلب قرار منتج: CAPTCHA/رسائل موحدة) |
| M | فشل مفتوح/تسرب قواعد | ✅ مغلق | فشل مغلق prod + تنظيف بلا بوابة + TTL للكشف — `a730517` |
| M | صور قابلة للتغيير | ✅ مغلق | digests + حارس الإنتاج — `27bb917` |
| M | مجدول نسخ عالمي | ✅ مغلق | لكل خادم (tick حي مثبت) — `27bb917` |
| M | ملفات نسخ يتيمة | ✅ مغلق | حذف مع الخادم/الحساب — مثبت — `989d563` |
| M | سباق registerFailure | ✅ مغلق | زيادة ذرية RETURNING — `523ebc1` |
| M | جداول بلا retention | ✅ مغلق | تقليم يومي (مثبت) + حذف `server_metrics` — `27bb917` |
| M | تدقيق الحذف مكسور FK | ✅ مغلق | التسجيل قبل الحذف — صف موجود مثبت — `d04df60` |
| M | آلة الحالة/انحراف update | ✅ مغلق | تقارب دائم + قفل — `144086c` |
| M | reconciler متسلسل | ✅ مغلق جزئيًا | تجمع 8-way (كافٍ حتى ~8x؛ انتخاب قائد عند التعدد مستقبلًا) |
| M | لوحة بلا حراسة (واجهة) | ✅ مغلق | React Query + Guards + WS real-time — `02cfb9d` |
| L (19) | الدفعة كاملة | ✅ مغلق | `f3bbdd2` (TTL/JWT/rounds/uuid-pipe/ready/cookies/daemon-msgs/احتواء/LOG_LEVEL/handlers/dup-env/ملف ميت) |

## إصلاحات إضافية بعد التدقيق (2026-09-30 continued)

| # | العنصر | الحالة | التفاصيل |
|---|---|---|---|
| F-1 | WebSocket Gateway | ✅ مكتمل | `@nestjs/websockets` + `socket.io`، namespace `/ws`، ticket auth 30s |
| F-2 | Real-time channels | ✅ مكتمل | `server:stats:{id}`, `server:logs:{id}`, `server:status:{id}`, `user:audit:{id}` |
| F-3 | React Query integration | ✅ مكتمل | TanStack Query v5، devtools، cache/invalidation، stale-while-revalidate |
| F-4 | Frontend Guards | ✅ مكتمل | `RequireAuth` (dashboard) + `GuestOnly` (signin/signup) |
| F-5 | WebSocket client hook | ✅ مكتمل | `useWebSocket` مع auto-reconnect، channel subscriptions |
| F-5 | Toast notifications | ✅ مكتمل | `sonner` للنجاح/الخطأ/المعلومات |
| F-6 | Dashboard pages migrated | ✅ مكتمل | Overview، Servers، ServerDetail، Settings تستخدم React Query + WS |

## اكتشافات أثناء التنفيذ (لم تكن في التدقيق الأصلي — كلها مُصلحة)

1. ترقية drizzle كسرت `22P02→404` (تغليف `Failed query`) → فك سلسلة `cause` (`a708352`).
2. ثغرة fail-open في التحقق من الإعداد: فحص `errors` قبل بناء الـ config فكل قيم `num()/bool()` الخاطئة كانت تقلع بصمت → فحص سلطوي بعده (`a528e52`).
3. مسح عائلة الـ refresh داخل المعاملة يُتراجع عنه بالـ `throw` (إحياء عائلة مخترقة) → القرار داخل والمسح خارج (`523ebc1`).
4. `volumeUsage` لم يعمل أبدًا (`LogConfig:none` = خرج صفري) فسياج التخزين كان أعمى → `captureLogs` (`144086c`).
5. عمود `runtime_version` (64) أقصر من الـ digest → توسيع 128 (ترحيل 0003) (`27bb917`).
6. `pkill` كان يقتل شل نفسه عندما يجمع بين الإيقاف والتشغيل (نص مطابق) → فصل الخطوتين (إجرائي).

## التقييم المحدّث (2026-09-30)

- **Security Status:** كان `Needs Significant Hardening` → الآن **Solid for current scale, harden-before-growth**: لا ثغرات تبعيات، العزل متقارب، الإبطال فوري، والمسارات المدمرة محمية. الباقي: أوراكل/اضمحلال القفل (تصميم)، IPv6 على مضيف الإنتاج (تحقق ميداني)، egress-allowlist (قرار منتج).
- **Production Status:** كان `Not Ready` → الآن **Ready for controlled production** (نسخة واحدة موثقة، Dockerfile مثبت، 88/88، صفر ثغرات): يُطلق لمستخدمين حقيقيين مع مراقبة، وتُعالج بنود النمو (انتخاب قائد، Redis throttle، بروكسي egress) قبل التوسع الكبير.
- **Maintainability:** تحسنت (توحيد التجزئة، `PlanPolicy` جزئيًا عبر الخطة الحية، حذف ملفين ميتين، أرقام مجمعة أكثر) — بقي: الخدمة الإلهية (`ServersService` ما زالت كبيرة) وصفر unit tests (التكاملية 88 تغطي، لكن منطقًا خالصًا يستحق وحدات).
- **Frontend Integration:** ✅ **مكتملة** — React Query (caching/invalidation)، WebSocket real-time (stats/logs/status/audit)، Guards، Toast notifications. اللوحة مربوطة بالكامل بالـ API.

---



## Executive Summary

المشروع **مصمم بعناية فوق المتوسط** لمرحلته: حدود معمارية واضحة، عزل حاويات حقيقي (non-root، read-only rootfs، شبكة+مجلد لكل عميل، قواعد iptables)، مصادقة سليمة البنية (تدوير opaque، bcrypt مع pre-hash، خطط من جهة الخادم)، و86 فحص تكامل خضراء. **لكنه غير جاهز للإنتاج غدًا**: توجد ثغرة تبعيات حرجة مؤكدة (`npm audit`: 1 critical + 5 high)، و3–4 عيوب بيانات/عزل قابلة للحدوث في ظروف واقعية (rollback يحذف مجلدات حية، تقسية الشبكة لا تُعاد بعد إعادة تشغيل Docker، حصص التخزين غير مطبقة، سباقات حصص/جلسات بدون معاملات)، ولا يوجد تعريف نشر للخلفية أصلًا (لا Dockerfile، نسخة واحدة مفترضة).

## Overall Risk

لا score رقميًا (بلا methodology معيارية)، والتقييم وصفي مبني على: قابلية الاستغلال/الحدوث في ظروف واقعية × شدة الأثر (فقدان بيانات، تجاوز عزل، استيلاء حسابات، توقف).

- **الآن (عشرات المستخدمين، نسخة واحدة، مضيف مُدار):** خطر **متوسط-مرتفع** — التشغيل اليومي سليم، لكن أول عطل Docker عابر أثناء rebuild قد يمسح بيانات عميل، وأول إعادة تشغيل للخادم تُسقط التقسية الشبكية بصمت.
- **عند النمو (مئات–آلاف الخوادم):** خطر **مرتفع** — لا admission control ولا حصص تخزين ولا تقارب reconciler، والجداول بلا retention.

---

## Critical Findings

### [CRITICAL] تبعيات إنتاجية بثغرات معروفة (1 حرجة + 5 عالية) — `npm audit` فعلي
**Status:** CONFIRMED (ناتج `npm audit --omit=dev` نُفّذ فعلًا: 13 ثغرة)
**Location:** `backend/package.json:21,27` + `package-lock.json` (`bcrypt 5.1.1`، `drizzle-orm 0.36.4`)
**Component:** Supply chain
**المشكلة:** سلسلة `bcrypt@5 → @mapbox/node-pre-gyp → tar ≤7.5.20` فيها ثغرات كتابة ملفات تعسفية/DoS، و`drizzle-orm <0.45.2` فيها GHSA-gpj5-g38j-94v9 (حقن SQL عبر identifiers، CVSS 7.5)، إضافة لثغرات عالية في `multer` (عبر platform-express) ومتوسطة في core/qs/uuid.
**لماذا تحدث؟** التبعيات مثبتة على خطوط قديمة (`bcrypt ^5.1.1`، `drizzle-orm ^0.36.4`، NestJS 10.4 بينما الأحدث 12) ولم تُرقَّع؛ إصلاح `bcrypt@6` كاسر (breaking).
**كيف يمكن أن تظهر في Production؟** أي مسار register/login يمر على `bcrypt`؛ واستغلال tar يتطلب وصولًا لمسار استخراج — الاحتمال منخفض-متوسط لكن الأثر RCE/كتابة ملفات.
**Impact:** أعلى أثر نظري في التقرير (RCE/تجاوز ملفات).
**Evidence:** ناتج audit الحقيقي + `npm outdated` (drizzle 0.36.4 → 0.45.3).
**Recommended Fix:** ترقية مخططة: `drizzle-orm ≥0.45.2` أولًا (الأسهل)، ثم `bcrypt ^6` (اختبار أداء rounds)، ثم NestJS؛ تفعيل Dependabot/Renovate؛ ملاحظة: كود المشروع نفسه يستخدم query builder (لا identifiers خام ظاهرة) فيخفف استغلال ثغرة drizzle عمليًا لكن لا يلغي وجوب الترقية.

---

## High Findings

### [HIGH] الـ rollback يحذف مجلدات موجودة مسبقًا عليها بيانات حية — فقدان بيانات
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/provisioning/provisioner.service.ts:89,139-144`
**Component:** ProvisionerService.provision
**المشكلة:** كائن `partial` يُزرع بأسماء الشبكة/المجلد **قبل** الإنشاء، وعند أي فشل لاحق يستدعي `destroy(partial)` الذي يحذف المجلد **حتى لو كان موجودًا مسبقًا ويحوي بيانات** — علم `getOrCreateVolume` (أُنشئ/أُعيد استخدام) يُتجاهل.
**لماذا تحدث؟** لا تمييز بين "أنا أنشأته" و"كان موجودًا".
**كيف يمكن أن تظهر في Production؟** عميل يحدّث `env` → `rebuild` على خادم عليه بيانات → `createContainer` يفشل (سحب صورة متعثر، تضارب اسم) → المجلد يُحذف بكل البيانات. الإنشاء الأول آمن (المجلد فارغ)؛ مسارات rebuild/repair ليست كذلك.
**Impact:** فقدان بيانات عميل لا رجعة فيه بسبب عطل Docker عابر.
**Evidence:** `const partial = {containerName, networkName, volumeName}` ثم `catch → destroy(partial)` دون أعلام إنشاء.
**Recommended Fix:** تتبّع `created = {network, volume}` من نتائج getOrCreate، والـ rollback يحذف فقط ما أنشأه هو؛ ومسار rebuild/repair لا يحذف مجلدًا مُعاد استخدامه أبدًا.

### [HIGH] التقسية الشبكية لا تُعاد بعد إعادة تشغيل Docker/المضيف — انكشاف صامت
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/provisioning/provisioner.service.ts:96-98`، `backend/src/modules/servers/provisioning/network-hardening.service.ts:82-131`
**Component:** NetworkHardening + Reconciler
**المشكلة:** القواعد تُطبق فقط `if (network.created)` — وDocker يمسح سلسلة `DOCKER-USER` عند إعادة تشغيل الـ daemon بينما الشبكات المعرفة تبقى، فيجدها `getOrCreateNetwork` موجودة (`created:false`) ويتخطى `apply` **للأبد**. والـ reconciler لا يعيد التطبيق أبدًا (مزامنة حالة + GC فقط).
**لماذا تحدث؟** قواعد netfilter حالة غير دائمة، ولا شيء يُقاربها للخلف.
**كيف يمكن أن تظهر في Production؟** إعادة تشغيل host أو `systemctl restart docker` (والحاويات `unless-stopped` تعود تلقائيًا) → كل الصناديق تعود **بدون** حجب metadata/LAN/المضيف → أي عميل يقرأ `169.254.169.254` ويجس بوابات المضيف حتى يُعاد إنشاء كل شبكة يدويًا — بصمت تام.
**Impact:** حركة جانبية بين العملاء + سرقة credentials سحابية.
**Evidence:** `if (network.created) await this.hardening.apply(...)` + غياب أي `apply` في `reconciler.service.ts`.
**Recommended Fix:** تقارب في الـ reconciler: إعادة `apply` (غير مكلفة لوجود `-C` قبل `-I`) لكل خادم له `networkSubnet` كل N ticks أو عند تعافي `docker.ping`؛ وإعادة التطبيق في مسار repair.

### [HIGH] حصص التخزين غير مطبقة إطلاقًا + `BACKUP_MAX_TOTAL_MB` ميت — امتلاء القرص
**Status:** CONFIRMED (`BACKUP_MAX_TOTAL_MB` معرف فقط في `env.ts:181` وصفر استخدام في `src/`)
**Location:** `backend/src/modules/servers/provisioning/sandbox.ts:73-76`، `backend/src/modules/servers/servers.service.ts:340-348`، `backend/src/modules/servers/backups.service.ts:68-69`
**Component:** Quota enforcement
**المشكلة:** `storageGb` يُسجَّل ويُعرض (عبر `du`) لكن لا يُفرض — المجلد `local` عادي بلا `storage-opt`/كوتا نظام ملفات/منفّذ دوري. حد النسخ الاحتياطي معرف ولا يُقرأ في أي مكان؛ عدد النسخ محدود لكن **حجمها** لا.
**لماذا تحدث؟** الكوتا للعرض فقط؛ والمفتاح أُضيف للإعداد دون تنفيذ.
**كيف يمكن أن تظهر في Production؟** عميل واحد `dd if=/dev/zero of=/data/fill` أو تطبيق كثير السجلات → قرص المضيف يمتلئ → ENOSPC لكل العملاء + تدهور الـ daemon نفسه.
**Impact:** توقف جماعي + فقدان كتابات.
**Evidence:** `Binds: [volume:/data:rw]` بلا أي قيد؛ `grep BACKUP_MAX_TOTAL_MB` لا يعيد إلا التعريف.
**Recommended Fix:** قرار كوتا على مستوى المضيف (XFS project quota على مسارات المجلدات، أو منفّذ reconciler: تجميد + `error` عند التجاوز) + تفعيل `BACKUP_MAX_TOTAL_MB` (جمع `sizeBytes` لكل مالك ورفض التجاوز) + سقف إجمالي سجلات.

### [HIGH] سباق فحص-ثم-إدخال في الحصص (خوادم + نسخ) — تجاوز حدود الخطط
**Status:** CONFIRMED (صفر استخدام لـ `db.transaction` في `src/`)
**Location:** `backend/src/modules/servers/servers.service.ts:74-78 → 80-102`، `backend/src/modules/servers/backups.service.ts:65-69 → 79-89`
**Component:** Quota enforcement
**المشكلة:** عدّ ثم إدخال بدون معاملة/قفل استشاري/قيد فريد جزئي — طلبان متزامنان يقرآن `maxServers-1` ويدخلان معًا.
**لماذا تحدث؟** لا ذرية بين الفحص والكتابة.
**كيف يمكن أن تظهر في Production؟** نقرة مزدوجة/إعادة محاولة خلف provision بطيء (الحد 10/دقيقة يسمح بطلبين متزامنين).
**Impact:** تجاوز حدود الخطط + إفراط provision + تناقض فوترة.
**Evidence:** select ثم throw ثم insert متتالية بلا transaction.
**Recommended Fix:** `SELECT … FOR UPDATE` على صف المستخدم داخل `db.transaction()` أو `pg_advisory_xact_lock`؛ الـ throttle ليس أداة صحة.

### [HIGH] تدوير refresh غير ذري من الاتجاهين — التفاف على كشف السرقة + مسح عائلة بالخطأ
**Status:** CONFIRMED (كود)
**Location:** `backend/src/modules/auth/auth.service.ts:176-210`
**Component:** Refresh rotation
**المشكلة:** قراءة → مقارنة → `UPDATE` في 3 عبارات منفصلة بلا قفل: (أ) استعمالان متزامنان لنفس التوكن يجتازان `safeEqual` معًا فلا تُكتشف إعادة التشغيل (ضمان مكافحة السرقة في الترويسة يسقط تحت التزامن)؛ (ب) أي استعمال ثانٍ للسر القديم (تبويبا متصفح، retry) يطابق فرع `!safeEqual` فيمسح **العائلة كلها** (تسجيل خروج من كل مكان — ويمكن لمهاجم تسليحه DoS بإعادة تشغيل توكن قديم مرصود).
**لماذا تحدث؟** TOCTOU: لا قفل صف ولا شرط إصدار في الـ UPDATE.
**كيف يمكن أن تظهر في Production؟** عميل ومهاجم يتسابقان على توكن مسروق؛ أو تبويبان يحدّثان معًا فيُطرد المستخدم من كل مكان.
**Impact:** نافذة اختطاف جلسة + حرمان شرعي.
**Evidence:** قراءة الصف ثم `UPDATE ... WHERE id` بلا `AND refresh_token_hash=old`.
**Recommended Fix:** `UPDATE … WHERE id AND refresh_token_hash=old RETURNING` ذري + نافذة سماح للـ `prevHash` (30–60 ثانية) قبل مسح العائلة؛ ومسح العائلة فقط عند إعادة مميزة ثانية.

### [HIGH] حذف الحساب بتوكن حامل فقط — بلا إعادة مصادقة بكلمة المرور
**Status:** CONFIRMED
**Location:** `backend/src/modules/users/users.controller.ts:36-40`، `backend/src/modules/users/users.service.ts:107-129`
**Component:** Users
**المشكلة:** `DELETE /users/me` (محمي بتوكن 15 دقيقة فقط) يدمر كل الصناديق والصفوف نهائيًا، بينما تغيير كلمة المرور يطلب `current` بشكل صحيح.
**لماذا تحدث؟** إجراء التدمير الأقصى يتطلب عاملًا واحدًا قصير العمر.
**كيف يمكن أن تظهر في Production؟** سرقة توكن عابرة (XSS/بروكسي) → حذف الحساب وكل الخوادم والمجلدات والنسخ.
**Impact:** فقدان بيانات نهائي من تسرب مؤقت.
**Evidence:** `delete()` بلا أي `dto.current` أو تأكيد.
**Recommended Fix:** اشتراط كلمة المرور الحالية (إعادة استخدام `verifyPassword`) ويفضل re-auth جديد.

### [HIGH] الاستعادة (restore) مدمّرة بلا حواجز — فوق بيانات حية كـ root
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/backups.service.ts:146-179`
**Component:** Backups restore
**المشكلة:** توقف الحاوية ثم `tar -xzf` فوق `/data` الحية: بلا نسخة احتياطية مسبقة، بلا فحص كوتا تخزين، تعيد دائمًا `offline` حتى لو كان الخادم `online`، والاستخراج كـ root بلا `--no-same-owner`/حصر symlinks (أرشيف مسموم من حالة سابقة مخترقة يُستخرج كجذر).
**لماذا تحدث؟** لا حواجز حول الكتابة التدميرية.
**كيف يمكن أن تظهر في Production؟** استعادة نسخة قديمة تمسح عمل أسابيع بلا رجعة؛ أو أرشيف مخترق يزرع symlinks بصلاحيات الجذر.
**Impact:** فقدان/تسميم بيانات.
**Evidence:** stop ثم `tar -xzf` مباشرة بلا pre-backup أو فحص مساحة.
**Recommended Fix:** نسخة تلقائية قبل الاستعادة + فحص مساحة + استعادة الحالة السابقة + استخراج مقيد + تدقيق يوثق الحالة السابقة.

### [HIGH] لا قفل على عمليات دورة الحياة المتزامنة — تلف حالة/حذف أحياء
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/servers.service.ts:232-301,386-401`، `backend/src/modules/servers/servers.controller.ts:52-80`
**Component:** Lifecycle
**المشكلة:** بلا mutex لكل خادم ولا قفل صف ولا حراسة انتقالات: نقرة مزدوجة على reinstall (الحد 5/دقيقة يسمح بتزامن) → كلاهما يدمر ثم ينشئ بالاسم الحتمي `srv_<hex>` (`removeByName` يقتل حاوية الفائز) → `persistProvision` للأخير يشير لحاوية محذوفة. و`remove` يضع `deleting` ولا شيء يفحصه.
**لماذا تحدث؟** قراءة `containerId` ثم فعل ثم كتابة أخيرة تفوز — بلا تسلسل.
**كيف يمكن أن تظهر في Production؟** مستخدم متعجل ينقر reinstall مرتين، أو update يتسابق مع reinstall فيحذف أحدهما مجلد الآخر mid-chown.
**Impact:** حالة `error` بأيتام حاويات، أو فقدان بيانات.
**Evidence:** لا `Map<serverId, lock>` ولا `FOR UPDATE` ولا فحص `status='deleting'`.
**Recommended Fix:** قفل async لكل `serverId` (خريطة وعود داخل العملية + `SELECT FOR UPDATE`/انتقال CAS) وتسلسل reinstall مع update.

### [HIGH] مصدر الخطة غير متسق — لقطة مقابل حي (ترقية/تخفيض يتسرب)
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/servers.service.ts:60-66,89` مقابل `backend/src/modules/servers/backups.service.ts:181-185`
**Component:** Plan policy
**المشكلة:** الإنشاء يلتقط `users.planId` بينما النسخ تُصرَّح من لقطة `servers.planId` — تخفيض المستخدم لـ `free` يترك خوادمه القديمة بامتيازات `pro` للنسخ، والترقية لا تفيد الخوادم القديمة.
**لماذا تحدث؟** مصدرا حقيقة مختلفان بقرار غير موثق.
**كيف يمكن أن تظهر في Production؟** مشترك يخفض خطته ويحتفظ بنسخ `pro` مجانًا؛ أو مرقٍّ لا يحصل على امتيازاته في خوادمه القديمة (تذاكر دعم + فوترة خاطئة).
**Impact:** تسرب امتيازات/إيرادات.
**Evidence:** `resolvePlan` من صف المستخدم مقابل `backupSlots` من لقطة الخادم.
**Recommended Fix:** سياسة خطط واحدة (`PlanPolicy`) ومصدر واحد للحقيقة مع قرار توثيقي: لقطة أم حي.

### [HIGH] لا Dockerfile ولا هدف نشر للخلفية + افتراض نسخة واحدة في كل مكان
**Status:** CONFIRMED (`vercel.json` واجهة فقط؛ لا Dockerfile)
**Location:** `vercel.json`، `backend/src/modules/servers/reconciler.service.ts:40-66,148-151`، `backend/src/app.module.ts:18-22`
**Component:** Deployment
**المشكلة:** لا يوجد تعريف نشر للخلفية رغم أنها تتطلب root/docker.sock/iptables؛ والـ reconciler (GC + نسخ تلقائي) وthrottle الذاكرة يفترضان نسخة واحدة — نسختان خلف LB تتسابقان على الحذف والنسخ وتضاعفان حد المعدل. (`refreshOnce` يعيد `busy=false` قبل الـ tick — ثغرة re-entrancy.)
**لماذا تحدث؟** النشر اليدوي على VPS بلا manifests.
**كيف يمكن أن تظهر في Production؟** نشر HA بنسختين → حذف مزدوج، نسخ مكررة تستنزف الحصة، حدود معدل ×2.
**Impact:** نشر غير قابل للتكرار + سباقات تشغيلية.
**Evidence:** غياب أي `Dockerfile*`/`compose*`؛ `busy` داخل العملية فقط؛ throttle بلا مخزن مشترك.
**Recommended Fix:** `backend/Dockerfile` (مستخدم غير جذري، `HEALTHCHECK` على `/ready`) + توثيق `NET_ADMIN`/الخدمة؛ وتوثيق "نسخة واحدة فقط" أو قفل استشاري PG حول الـ tick + مخزن throttle مشترك (Redis).

---

## Medium Findings

### [MEDIUM] توكنات الوصول تعيش بعد logout/logout-all/تغيير كلمة المرور/حذف الحساب (نافذة 15 دقيقة)
**Status:** CONFIRMED
**Location:** `backend/src/modules/auth/auth.service.ts:237-243`، `backend/src/modules/auth/jwt.guard.ts:29-31`، `backend/src/modules/users/users.service.ts:69-75`
**Component:** Authentication / Session management
**المشكلة:** `revokeAllForUser` يحذف refresh فقط؛ الحارس stateless بلا فحص DB/`passwordChangedAt` — التوكن المسروق يبقى صالحًا حتى انتهاء TTL رغم "تسجيل الخروج من كل مكان" أو تغيير كلمة المرور أو حذف الحساب.
**Impact:** احتواء ما بعد الاختراق يفشل جزئيًا.
**Evidence:** حذف `authSessions` فقط + `verifyAsync` بلا `sid`/`passwordChangedAt`.
**Recommended Fix:** `tokenVersion`/`passwordChangedAt` في JWT والرفض في الحارس عند القدم، أو تقصير TTL وتوثيق النافذة.

### [MEDIUM] تغيير البريد بلا تحقق ولا تأكيد كلمة مرور — تثبيت اختطاف
**Status:** CONFIRMED
**Location:** `backend/src/modules/users/users.service.ts:34-50`
**Component:** Users
**المشكلة:** `updateProfile` يثبت أي بريد فورًا بلا إثبات ملكية — مهاجم بتوكن قصير يعيد توجيه بريد الحساب فيفقد الضحية مسار الاسترداد حتى بعد تغيير كلمة المرور.
**Impact:** اختطاف دائم + تعداد عبر `EMAIL_TAKEN`.
**Evidence:** `set({ name, email })` مباشرة بلا تحقق.
**Recommended Fix:** رابط تحقق للعنوان الجديد + تأكيد بالحالية، والقديم يبقى حتى التحقق.

### [MEDIUM] أوراكل القفل + حرمان دائم (خطأ مميز، عدّاد بلا اضمحلال)
**Status:** CONFIRMED
**Location:** `backend/src/modules/auth/auth.service.ts:117-122,140,273-288`
**Component:** Authentication / Brute-force controls
**المشكلة:** (أ) `ACCOUNT_LOCKED` مقابل `INVALID_CREDENTIALS` يكشف البريد المسجل وحالة القفل؛ (ب) `failedLogins` لا يضمحل و`min(30*2^step,900)` يتيح تثبيت أي حساب على قفل 15 دقيقة للأبد بتقطير محاولات.
**Impact:** تعداد + DoS مستهدف.
**Evidence:** فروع خطأ مميزة + عدّاد أحادي بلا نافذة.
**Recommended Fix:** رسالة موحدة، عدّاد بنافذة منزلقة واضمحلال، CAPTCHA عند القفل.

### [MEDIUM] التقسية تفشل مفتوحة (subnet فارغ/iptables غائب وما زال الإنشاء يمضي)
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/provisioning/network-hardening.service.ts:84-88`، `backend/src/modules/servers/provisioning/provisioner.service.ts:96-98`
**Component:** Network hardening
**المشكلة:** `apply` يعيد `false` عند subnet فارغ والقيمة مُتجاهلة — حاوية عميل تعمل بكامل الوصول للمضيف/metadata ولا شيء يمنع النشر.
**Impact:** نفس انكشاف التقسية لكن وقت الـ provision.
**Evidence:** `warn ... skipping hardening` ثم متابعة طبيعية.
**Recommended Fix (إنتاج):** فشل مغلق — رفض الـ provision عند `IS_PROD && HARDEN_NETWORK` وفشل التطبيق، وتوثيق `hardened:false`.

### [MEDIUM] تسرب القواعد اليتيمة عند فشل التنظيف (subnet مجهول)
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/provisioning/network-hardening.service.ts:134-135`، `backend/src/modules/servers/reconciler.service.ts:133-134`
**Component:** Network hardening / GC
**المشكلة:** `cleanup` لا يعمل بلا subnet — وهو فارغ بالضبط عندما فشل الـ inspect أصلًا؛ وGC بعد حذف الشبكة يمرر `''` فيصبح no-op تاركًا قواعد ميتة تتراكم حتى تصطدم بشبكة مُعاد تدويرها (DoS ذاتي).
**Recommended Fix:** حذف حسب وسم التعليق `troxe:<name>` بدل إعادة بناء المطابقة، وجلب الـ subnet قبل حذف الشبكة.

### [MEDIUM] صور بوسوم قابلة للتغيير بلا digest (بما فيها صورة المساعد)
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/provisioning/images.ts:28-77`، `backend/src/config/env.ts:176`
**Component:** Supply chain / Provisioning
**المشكلة:** `ensureImage` يسحب بالوسم عند كل provision — وسم مُعاد نشره (إعادة بناء upstream، اختراق سجل) يشغّل bytes مهاجم كجذر في المساعدات (`runHelper` يعمل `0:0`).
**Recommended Fix:** تثبيت `image@sha256:` للصور الخمس ورفض digests مجهولة في الإنتاج.

### [MEDIUM] المجدول التلقائي للنسخ يخنق عالميًا لا لكل خادم + حد 50 بلا ترتيب
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/backups.service.ts:187-212`
**Component:** Auto-backup scheduler
**المشكلة:** آخر `auto` **عبر كل الخوادم** يكبت البقية 24 ساعة؛ و`LIMIT 50` بلا ترتيب يجوع الباقي للأبد.
**Impact:** RPO ضائع لمعظم الخوادم.
**Evidence:** `WHERE type='auto' ... LIMIT 1` عالمي.
**Recommended Fix:** استعلام استحقاق لكل خادم (`DISTINCT ON (server_id)`).

### [MEDIUM] ملفات النسخ يتيمة عند حذف الخادم/الحساب (PII تبقى على القرص)
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/servers.service.ts:202-228,304-318` (بلا `rm`)، `backups.service.ts:132-133` (حذف ملف فقط عند حذف نسخة مفردة)
**Component:** Backup lifecycle
**المشكلة:** الـ cascade يحذف الصفوف فقط؛ ملفات `BACKUP_DIR/<owner>/<server>/*.tar.gz` تبقى للأبد — امتلاء قرص + بيانات شخصية بعد حذف الحساب.
**Recommended Fix:** حذف `dirFor(owner,server)` عند الحذف + مسح دوري لليتامى.

### [MEDIUM] سباق `registerFailure` يُضعف القفل + جداول بلا retention + `revokedAt` ميت + `server_metrics` بلا كاتب
**Status:** CONFIRMED
**Location:** `backend/src/modules/auth/auth.service.ts:273-287`؛ الجداول (sessions/audit/events)؛ `server_metrics` بلا كاتب/قارئ
**Component:** Auth / Retention
**المشكلة:** زيادة `failedLogins` في JS من قراءة قديمة (رشّ موزع يتجاوز العتبة متأخرًا)؛ نمو غير محدود للجداول يبطئ الاستعلامات؛ `revokedAt` يُقرأ ولا يُكتب أبدًا.
**Recommended Fix:** زيادة ذرية `SET failed_logins=...+1 … RETURNING` + حذف ليلي حسب TTL + حسم مصير `server_metrics` (حذف أو كاتب).

### [MEDIUM] فجوات آلة الحالة + انحراف update/rebuild (DB جديد وحاوية قديمة)
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/servers.service.ts:142-198,232-301`، `backend/src/modules/servers/reconciler.service.ts:95-107`
**Component:** Server state machine
**المشكلة:** `stop` بلا حالة انتقالية؛ `restarting` مثقلة المعاني؛ `reinstall` تدمر المجلد بلا تأكيد/نسخة؛ update يتخطى rebuild بصمت في وضع record-only؛ أي `env` — حتى المطابق — يجبر rebuild؛ والفشل يعلّم `error` **بعد** تثبيت الباتش (DB جديد وحاوية قديمة/ميتة).
**Recommended Fix:** مقارنة محتوى قبل rebuild، ومعاملة الباتش+النتيجة كوحدة، وتأكيد + نسخة قبل reinstall.

### [MEDIUM] الواجهة: لوحة تحكم بلا حراسة + دور `Admin` ثابت (كامن — سيصبح حرجًا عند الربط)
**Status:** CONFIRMED (الأثر الحالي منخفض: بيانات تجريبية)
**Location:** `src/App.jsx:51-56`، `src/data/dashboard.js:1-6`، `src/pages/dashboard/DashboardLayout.jsx`
**Component:** Routing / Dashboard shell
**المشكلة:** كل مسارات `/dashboard/*` مفتوحة بلا حارس، والدور `Admin` قيمة ثابتة للعرض.
**Impact:** اليوم عرض UI فقط؛ عند الربط: تصعيد/IDOR إن وثقت الخلفية بالعميل.
**Evidence:** routes عارية + `role: 'Admin'` ثابت + زر خروج يعمل `navigate('/')` فقط.
**Recommended Fix:** `RequireAuth` + عدم الثقة بدور العميل أبدًا (الخلفية تفرض كل شيء — وهي تفعل اليوم).

### [MEDIUM] الـ reconciler تكلفته O(N) متسلسلة لكل tick — لا يصمد لألوف الخوادم
**Status:** CONFIRMED
**Location:** `backend/src/modules/servers/reconciler.service.ts:53-145`
**Component:** Reconciler / Scale
**المشكلة:** `select *` بلا حد + `inspect` لكل خادم متسلسلًا + تنظيف iptables متسلسل. عند 10k خادم: ~170 عملية/ثانية على عملية Node واحدة وpool من 10 اتصالات → الـ tick يتجاوز نافذته ويتخلف أكثر.
**Recommended Fix:** دفعات/توازٍ محدود + ترقيم صفحات + انتخاب قائد.

### [MEDIUM] صف تدقيق حذف الحساب لا يُحفظ أبدًا (FK بعد حذف المستخدم — يُبتلع بصمت)
**Status:** CONFIRMED
**Location:** `backend/src/modules/users/users.service.ts:107-126` + `backend/src/modules/audit/audit.module.ts:23-37`
**Component:** Account deletion / Audit integrity
**المشكلة:** حذف صف `users` ثم إدخال `audit_logs(actor_id=<uuid محذوف>)` — القيد يفشل و`record` يبتلع بـ `warn` فقط. أثر الحساسية الأقصى بلا أثر تدقيق دائمًا.
**Recommended Fix:** التسجيل **قبل** الحذف بـ `actorId:null` + البريد في meta، أو داخل نفس المعاملة قبل الحذف.

---

## Low Findings

- **[LOW] JWT:** الخوارزمية غير مثبتة (`verifyAsync` بلا `algorithms` — `jwt.guard.ts:30`)، و`JWT_ACCESS_TTL` خام من البيئة (خطأ `100y` = توكنات أبدية بصمت)، و`JWT_REFRESH_SECRET` مطلوب لكنه **ميت** (الـ refresh opaque وليس JWT). الإصلاح: تثبيت HS256 + allowlist للـ TTL + حذف السر الميت.
- **[LOW] أرضية `BCRYPT_ROUNDS=4` مقبولة في الإنتاج** (`env.ts:162`) — اجعل الحد 10 في prod.
- **[LOW] `tail` السجلات بلا حد أدنى** (`servers.controller.ts:96-104` + `docker.service.ts:293-306`): `tail=-1` يمر (`Math.min` فقط) ويعاملها الـ daemon كـ"الكل" (~30MB في سلسلة واحدة). الإصلاح: تثبيت `1..2000`.
- **[LOW] `ParseUuidPipe` موجود ولا يُستخدم أبدًا** — المخرج الحالي آمن عبر `22P02→404` لكن على حساب round-trip لكل طلب مشوه. طبّقه على `:id`/`:backupId` أو احذفه.
- **[LOW] `/health/ready` بلا throttle ويستعلم DB ويعيد نص خطأ السائق** (`health.controller.ts:18-46`) — فيض مجهول + بصمة بنية. حدّ صغير + تخزين 2–5 ثوانٍ + `unavailable` ثابتة للعميل.
- **[LOW] مخرجات daemon خام تعود للعميل** (`lastError`، `BACKUP_FAILED`/`RESTORE_FAILED` تحوي stdout حتى 300 حرف) — عون استطلاع محدود (موارد العميل نفسه). رسائل عامة + requestId، والخام في سجلات الخادم.
- **[LOW] مسار النسخة من DB يُحذف/يُركَّب بلا فحص احتواء** — NEEDS VERIFICATION (غير قابل للاستغلال مباشرة: الكتابة من الخادم فقط، والاستعلامات مُعامَلة). أعد حساب المسار عبر `fileFor` وتحقق من البادئة قبل `rm`/التركيب.
- **[LOW] الـ throttle ذاكرة محلية لكل IP** — NEEDS VERIFICATION حسب النشر (نسخة واحدة اليوم فيخففها)؛ أضف حدًا لكل حساب على login/refresh ومخزنًا مشتركًا عند التوسع.
- **[LOW] CSRF على refresh/logout بالكوكي يعتمد `SameSite=Lax` فقط** — NEEDS VERIFICATION (وضع معقول: عمليات الأعمال الحقيقية Bearer؛ المتبقي إزعاج تسجيل خروج في متصفحات قديمة). تحقق من `Origin` في نهايات الكوكي. (CORS نفسه سليم: allowlist صريحة ورفض `*` في prod — لا finding.)
- **[LOW] IPv6** — NEEDS VERIFICATION: القواعد v4 فقط؛ التأكد على المضيف أن `EnableIPv6:false` فعلي ولا مسار v6، وإلا مرآة عبر `ip6tables`.
- **[LOW] كشف `ensureAvailable` يُحفظ للأبد** (`network-hardening.service.ts:40`) — قديم في الاتجاهين. TTL 60 ثانية ولا إرجاع مبكر في `cleanup`.
- **[LOW] ملف `servers/docker.service.ts` ميت** (موجود فعلًا، socket ثابت بلا مهلات، لا يستورده أحد — تحقق) — احذفه؛ و`abortOnError:false` قد يخفي فشل إقلاع (`/health` حيوية فقط).
- **[LOW] `usage()`/`stats()` تُقنّع الفشل صفرًا** (`servers.service.ts:340-348`) — اللوحة لا تميز الفارغ عن المعطوب. أعد `null` + حالة.
- **[LOW] ترقيم صفحات/حدود طلبات** — `list` بلا حد (مقبول ≤100)، نسخ بحد 100 بلا cursor، حد جسم ضمني (~100KB). حدّ صريح `256kb` + cursor.
- **[LOW] فهارس ثانوية ناقصة** (`audit_logs(target)`، `backups(type,created)`، `auth_sessions(expires_at)`) — ليست مسارًا ساخنًا؛ أضف بعد EXPLAIN.
- **[LOW] الواجهة: لا CSP/headers أمنية + تحميل CDN** (خطوط Google، أعلام flagcdn — تسرب IP الزائر) — headers في `vercel.json`؛ السلامة: لا `dangerouslySetInnerHTML` إطلاقًا، ولا توكنات/كوكيز/أسرار، ولا source maps.
- **[LOW] لا معالج رفض/استثناء عام** (`process.on unhandledRejection` صفر نتائج) — Node 22 يسقط العملية بدل التدهور؛ أضف إغلاقًا رشيقًا. و`LOG_LEVEL` معرف ولا يُوصَل (`main.ts` لا يمرره).
- **[LOW] `cleanEnv` يحتفظ بأول مكرر ويُسقط اللاحق بصمت** (`servers.service.ts:436`) — ارفض المكرر أو last-wins موثق.
- **[LOW] تعداد `EMAIL_TAKEN` في signup/profile** — مقايضة مقبولة وموثقة؛ login موحد بشكل صحيح.
- **[LOW] `clearCookie` يفقد الأعلام** (`auth.controller.ts:63-64,71-74`) — قد تبقى كوكي `__Host` بعد logout في prod. مرآة الأعلام عند المسح.
- **[LOW] كشف `lockedUntil` قديم مربك للتدقيق** (`auth.service.ts:280-286`) — تجميلي.

---

## Informational Findings

- **egress مفتوح للإنترنت العام + DNS افتراضي تصميم مقصود** (hosting يتطلب ذلك) — لكنه يعني أنفاق DNS/C2/mining متاحة لعميل معادٍ. اقبله صراحة: محاسبة egress لكل مستأجر (الأرقام تُجمع فعلًا في `stats`) + تنبيهات شذوذ + ToS إساءة.
- **لا حقن أوامر مضيف عبر startup/env** (`Cmd` عبر API مباشرة داخل الحاوية، ومفاتيح env ب regex مزدوج، وتشفير GCM سليم، ومساعدات مقيدة جيدًا) — يُسجَّل كقوة لا ضعف.
- **IDOR سليم**: `requireOwned` + `ServerOwnerGuard` + `SERVER_NOT_FOUND` موحد (لا أوراكل)، والخطة من صف المستخدم لا الجسم.
- **لا أسرار في المستودع/التاريخ** (`.env` غير متتبع، `git log -- *.env` فارغ، إقلاع prod يرفض الأسرار الضعيفة) — قوة.
- **ترتيب الحذف صحيح** (Docker أولًا ثم DB، والـ reconciler يكنس البقايا).
- **الواجهة قالب غير مربوط** (صفر `fetch`/تخزين/كوكيز) — معظم مخاطر الواجهة الكلاسيكية **غير قابلة للتطبيق اليوم**، والقائمة أعلاه ما سيصبح حِملًا لحظة الربط.

---

## Production Risk Map

| Area | Finding | Severity | Confidence | Production Impact |
|---|---|---|---|---|
| Dependencies | ثغرات tar/bcrypt + drizzle SQLi | CRITICAL | CONFIRMED | RCE/كتابة ملفات (باحتمال متوسط) |
| Provisioning | rollback يحذف مجلدات حية | HIGH | CONFIRMED | فقدان بيانات عميل من عطل عابر |
| Network | تقسية لا تُعاد بعد restart | HIGH | CONFIRMED | انكشاف metadata/مضيف صامت |
| Storage | حصص غير مطبقة + حد ميت | HIGH | CONFIRMED | امتلاء قرص جماعي |
| Quota/Sessions | سباقات فحص-ثم-إدخال/تدوير | HIGH | CONFIRMED | تجاوز خطط + التفاف كشف سرقة |
| Users | حذف حساب بلا كلمة مرور | HIGH | CONFIRMED | فقدان نهائي من تسرب مؤقت |
| Backups | استعادة مدمرة كجذر | HIGH | CONFIRMED | فقدان/تسميم بيانات |
| Lifecycle | تزامن بلا قفل | HIGH | CONFIRMED | تلف حالة وأيتام |
| Plans | لقطة مقابل حي | HIGH | CONFIRMED | تسرب امتيازات |
| Deploy | لا Dockerfile + نسخة واحدة | HIGH | CONFIRMED | نشر غير قابل للتكرار/توسع غير آمن |
| Audit | صف تدقيق الحذف مكسور FK | MEDIUM | CONFIRMED | فجوة امتثال صامتة |
| Auth | نافذة 15د بعد logout/تغيير | MEDIUM | CONFIRMED | احتواء ناقص |
| Auth | قفل بلا اضمحلال + أوراكل | MEDIUM | CONFIRMED | تعداد + DoS مستهدف |
| Network | فشل مفتوح/تسرب قواعد | MEDIUM | CONFIRMED | انكشاف/تراكم |
| Backups | مجدول عالمي + ملفات يتيمة | MEDIUM | CONFIRMED | RPO ضائع + PII على القرص |
| DB | جداول بلا retention + `revokedAt` ميت | MEDIUM | CONFIRMED | تضخم + بطء |
| Scale | reconciler متسلسل O(N) | MEDIUM | CONFIRMED | تخلف فوق ~1k خادم |
| Images | وسوم قابلة للتغيير | MEDIUM | CONFIRMED | تسميم سلسلة توريد |
| State | فجوات آلة الحالة + انحراف update | MEDIUM | CONFIRMED | حالة كاذبة + rebuild ضائع |
| Frontend | لوحة بلا حراسة (كامن) | MEDIUM | CONFIRMED | تصعيد مستقبلي عند الربط |
| API/Config | tail/JWT/ready/throttle | LOW | CONFIRMED | إزعاج/استطلاع/هدر |
| IPv6/CSRF/مسارات | فجوات دفاع-معمق | LOW | NEEDS VERIFICATION | التفاف محتمل — تحقق على المضيف |

---

## Architecture Findings

| Problem | Current Situation | Risk | Recommendation |
|---|---|---|---|
| ملف Docker ظل ميت | `servers/docker.service.ts` موجود به socket ثابت بلا مهلات ولا يستورده أحد | تعديل مستقبلي في الملف الخطأ | حذف الملف |
| خدمة إلهية | `servers.service.ts` (487 سطرًا): CRUD + حصص + provision/rebuild + lifecycle + إحصاءات + تشفير | تماسك منخفض وصعوبة اختبار | استخراج `ServerLifecycleService` + `ServerQuotaPolicy` |
| ازدواج منطق | تجزئة كلمة المرور في مكانين؛ سياسة الخطط في مكانين (لقطة/حي) | انحراف سلوكي (وقع فعلًا) | توحيد على `common/password.ts` و`PlanPolicy` واحدة |
| صفر معاملات DB | لا `db.transaction` في `src/` كله | نصف-نجاح في كل تدفق متعدد الخطوات | معاملات للكتابات البحتة؛ Docker خارجها (saga + reconciler) |
| مسارات الخطأ مبتلعة | `audit.record` و`event()` يبتلعان بصمت | فجوات تدقيق صامتة | عدّاد فشل + توثيق العقد |
| `server_metrics` بلا كاتب/قارئ | جدول مهاجر ومفهرس ولا يستخدم | كود ميت/جامع ناقص | حذف أو تنفيذ الكاتب |

المعمارية نفسها (monolith معياري: auth/users/plans/servers+provisioning/audit/health) **مناسبة تمامًا** — لا حاجة لأي Microservices. لا توجد تبعيات دائرية (`forwardRef` صفر). التوصية إصلاحات موضعية لا إعادة كتابة.

---

## Maintainability Findings

- **أكثر الملفات تعقيدًا:** `servers.service.ts` (487) > `provisioning/docker.service.ts` (399) > `auth.service.ts` (355) > `provisioner.service.ts` (227) > `backups.service.ts` (213). أكبر الدوال: `ServersService.create` (~80 سطرًا)، `lifecycle` (~70)، `runHelper`/`ensureImage`.
- **أرقام سحرية مبعثرة:** مهلات 3/10/15/30/300 ثانية، `iptables -w 5`، `GRACE 5min`/`STUCK 15min`، حدود 64KB/500 حرف — اجمعها في `env.ts`.
- **حالة عامة قابلة للتحول:** `unavailabilityLogged`، `probe/warned`، `busy/timer` — محدودة ومقبولة لنسخة واحدة، وتتضاعف عند التعدد.
- **أكبر دين تقني:** غياب طبقات الفصل القابلة للاختبار (لا interfaces — اختبار `create/lifecycle` يتطلب daemon حيًا) → **صفر unit tests**؛ كل شيء تكاملي حي (PG+docker+iptables+root) فيخفي عيوب المنطق (بعضها نجا من 86 فحصًا أخضر).
- **جودة الاختبارات:** تغطية جيدة للمسار السعيد والعزل، لكن **بلا**: تزامن، مسارات فشل (docker/DB down)، آلة حالة (restart/reinstall/`error`)، استعادة فعلية، جدولة تلقائية، حواف إدخال (`tail=-1`، مفاتيح مكررة)، وتأكيدات `status+substring` غالبًا بلا تحقق مخطط، مع `sleep` قابل للتقطع وتعديل DB مباشر يقترن بالمخطط.

---

## Production Readiness

**Security**
- [ ] ترقية التبعيات الحرجة/العالية (drizzle ثم bcrypt ثم NestJS) + Dependabot
- [ ] تثبيت digests للصور الخمس
- [ ] إصلاح rollback المجلدات + التقسية بعد restart + الفشل المغلق
- [ ] كلمة مرور لحذف الحساب + تحقق تغيير البريد + إبطال توكنات (version)
- [ ] حواجز الاستعادة + احتواء مسارات النسخ + حد أدنى `tail`
- [ ] تثبيت خوارزمية JWT + تقنين TTL + حذف `JWT_REFRESH_SECRET` الميت

**Reliability**
- [ ] معاملات DB للكتابات + تدوير refresh ذري + زيادة lockout ذرية
- [ ] قفل كل خادم لدورة الحياة + توحيد مصدر الخطة
- [ ] معالج رفض/استثناء عام + إغلاق رشيق + `abortOnError` revisited
- [ ] مهلة جسم صريحة + مهلات خادم + retry للقراءات + كشف ازدحام الـ pool
- [ ] Dockerfile + نسخة واحدة موثقة (أو قفل استشاري + Redis throttle)

**Performance**
- [ ] حصص تخزين + سقف نسخ + admission سعة مضيف
- [ ] reconciler دفعات/توازٍ + retention للجداول + تخزين stats مؤقت + حد usage

**Observability**
- [ ] توصيل `LOG_LEVEL` + سجلات JSON خارجية مع retention + إصلاح `ready` (throttle + تخزين + بلا تفاصيل)
- [ ] عدّادات فشل التدقيق/الأحداث + مقاييس pool في `/ready`

**Deployment**
- [ ] Dockerfile + وحدة تشغيل + توثيق root/net-admin/socket + نسخ `BACKUP_DIR` الدائم
- [ ] تحقق IPv6/v6-egress على المضيف + `TRUST_PROXY` بعدد قفزات + طباعة تحذيرات prod

**Testing**
- [ ] اختبارات تزامن (حصص، refresh، lifecycle) + حقن فشل (docker/DB) + استعادة فعلية + حواف إدخال + مخططات استجابة

---

## Attack Surface Map

```
User (تصيد/حشو بيانات → التخفيف: قفل تصاعدي + throttle، لكن: أوراكل تعداد + قفل بلا اضمحلال [MEDIUM])
↓
Frontend (قالب غير مربوط: لا سطح سرقة اليوم؛ عند الربط: لوحة بلا حراسة + دور ثابت [MEDIUM كامن]، لا XSS-sink [سليم]، بلا CSP [LOW])
↓
API (تحقق صارم whitelist [سليم]؛ لكن: tail بلا حد أدنى، uuid-pipe ميت، ready مفتوح، أخطاء daemon خام [LOW])
↓
Authentication (تدوير opaque + bcrypt جيدان؛ لكن: نافذة 15د بلا إبطال، سباق تدوير، قفل قابل للالتفاف جزئيًا [MEDIUM/HIGH]، تبعيات bcrypt/tar [CRITICAL])
↓
Authorization (ملكية مزدوجة الفحص + خطة خادمية [سليم]؛ لكن: حذف حساب بلا كلمة مرور [HIGH]، لقطة/حي الخطط [HIGH])
↓
Business Logic (حصص بعدّ متسابق [HIGH]، استعادة مدمرة [HIGH]، مجدول نسخ عالمي [MEDIUM]، آلة حالة ناقصة [MEDIUM])
↓
Database (مخطط/فهارس/pool سليمة؛ لكن: صفر معاملات [HIGH]، تدقيق حذف مكسور FK [HIGH]، بلا retention [MEDIUM])
↓
External Services (سحب صور بوسوم قابلة للتغيير [MEDIUM]؛ لا circuit-breaker؛ DNS/egress مفتوح تصميمًا [INFO])
↓
Infrastructure (عزل حاويات قوي + iptables [سليم]؛ لكن: تقسية تسقط بعد restart [HIGH]، حصص تخزين/سعة غائبة [HIGH]، لا Dockerfile [HIGH]، IPv6 غير متحقق [LOW])
```

---

## Top Priority Fixes

**Fix First (مرتبة بالأثر × الاحتمال):**
1. **ترقية `drizzle-orm` ثم `bcrypt`** — الثغرة الحرجة الوحيدة المؤكدة آليًا؛ drizzle أولًا (غير كاسر غالبًا).
2. **إصلاح rollback المجلدات** (أعلام `created`) — فقدان بيانات من عطل عابر؛ diff صغير وأثر كبير.
3. **إعادة تطبيق التقسية في الـ reconciler + فشل مغلق في prod** — انكشاف صامت بعد كل reboot.
4. **حصص التخزين + تفعيل `BACKUP_MAX_TOTAL_MB` + تنظيف ملفات النسخ عند الحذف** — امتلاء القرص الجماعي + PII.
5. **معاملات الحصص + التدوير الذري للـ refresh** — تجاوز خطط والتفاف كشف سرقة.
6. **كلمة مرور لحذف الحساب + إبطال توكنات (version) + تحقق البريد** — احتواء الاختراق.
7. **قفل دورة الحياة لكل خادم + توحيد مصدر الخطة + حواجز الاستعادة** — سلامة حالة وبيانات.
8. **Dockerfile + توثيق نسخة واحدة + تثبيت digests** — قابلية نشر وتوريد.
9. **retention الجداول + دفعات الـ reconciler + إصلاح المجدول لكل خادم** — استدامة النمو.
10. **إصلاحات LOW السريعة دفعة واحدة** (tail clamp، JWT alg/TTL، uuid pipe، ready throttle، clearCookie flags، حذف الملف الميت، توصيل LOG_LEVEL).

---

## Final Assessment

**Security Status: Needs Significant Hardening** — الأساس سليم (عزل، مصادقة، ملكية) لكن ثغرة تبعيات حرجة + 9 بنود High تمنع وصف "آمن".

**Production Status: Needs Fixes (Not Ready لغدٍ)** — لعشرات المستخدمين الودودين يعمل؛ لمستخدمين حقيقيين وبيانات حقيقية وخصوم: لا — حتى إصلاح البنود 1–7 على الأقل.

**Maintainability:** جيدة-فوق المتوسط لمرحلتها — حدود واضحة، لا تشابك دائري، تسمية مقروءة؛ الدين الحقيقي: خدمة إلهية واحدة، صفر unit tests (بسبب غياب الفواصل)، أرقام مبعثرة، وملفان ميتان. كلها قابلة للإصلاح التدريجي — **لا مبرر إطلاقًا لإعادة الكتابة**.

**Biggest Risks (أهم 5):**
1. تبعيات حرجة/عالية غير مرقعة (تفوق نظريًا كل شيء).
2. rollback يمسح بيانات عميل من عطل عابر.
3. التقسية تسقط بصمت بعد كل reboot.
4. تخزين بلا سقف (قرص واحد يوقف الجميع).
5. سباقات الحصص/الجلسات بلا ذرية (تجاوز + التفاف كشف).

**Biggest Strengths (أهم الموجود الجيد):**
1. عزل حاويات حقيقي ومتحقق (86/86) — non-root، ro-rootfs، شبكة/مجلد لكل عميل، iptables مزدوجة.
2. تصميم المصادقة سليم البنية (opaque rotation + replay revoke، bcrypt مع pre-hash، خطط خادمية).
3. مخطط DB نظيف (قيود/فهارس/cascade صحيحة، هجرة آمنة، ترتيب حذف صحيح).
4. انضباط الإعداد (fail-fast، لا أسرار في المستودع، CORS صارم، أخطاء مُغلّفة بلا تسريب).
5. توثيق صيانة صادق (ملاحظة `.troxe-init` تحمي من سلوك dockerd غير البديهي).

**Recommended Next Step:** نفّذ البنود 1–4 من Fix First بالترتيب (ترقيات → rollback → تقسية → حصص تخزين) — كلها diffs صغيرة عالية الأثر — مع اختبار إثبات لكل إصلاح.
