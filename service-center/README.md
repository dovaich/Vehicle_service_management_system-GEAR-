# GEAR – نظام إدارة مركز صيانة سيارات (BMW) | Car Service Center Management

نظام متكامل لإدارة مركز صيانة سيارات باللغتين **العربية والإنجليزية**، يعمل على **الموبايل والكمبيوتر والتابلت** من المتصفح، ويمكن تثبيته كتطبيق (PWA).

A complete, bilingual (Arabic / English) service-center management system that runs on **mobile, tablet and PC** from any browser and can be installed as an app (PWA).

---

## التشغيل السريع | Quick start

المتطلبات: **Node.js 22.13 أو أحدث** فقط (لا توجد مكتبات خارجية - قاعدة البيانات SQLite مدمجة).

Requirements: **Node.js ≥ 22.13** only. No `npm install` needed, because the database (SQLite) is built into Node.

```bash
cd service-center
npm start
```

- من الكمبيوتر: افتح `http://localhost:3000`
- من الموبايل (على نفس شبكة الواي فاي): افتح العنوان الذي يظهر في الشاشة مثل `http://192.168.1.10:3000` ثم من قائمة المتصفح اختر **"إضافة إلى الشاشة الرئيسية" / Install app**
- الدخول الافتراضي: **admin / admin123** (سيطلب منك تغييرها)

بيانات تجريبية (اختياري، والسيرفر شغال) | Optional demo data (while the server runs):

```bash
node scripts/demo-data.js http://localhost:3000
```

الاختبارات | Tests: `npm test`

إعدادات اختيارية | Optional env vars: `PORT` (default 3000), `HOST` (default 0.0.0.0), `GEAR_DATA_DIR` (default `./data`).

---

## الوحدات | Modules

| الوحدة | Module | ماذا تفعل |
|---|---|---|
| لوحة التحكم | Dashboard | سيارات في الورشة، جاهزة للتسليم، بانتظار قطع، مواعيد اليوم، الصيانات المستحقة، نواقص المخزن، مبيعات وتحصيل اليوم والشهر، رصيد الخزائن، المستحقات، رسم بياني للمبيعات |
| المواعيد والحجوزات | Appointments | حجز موعد لعميل/سيارة، تذكير بالواتساب، تحويل الموعد إلى استلام بضغطة |
| **استلام السيارة** | Vehicle check-in | العداد، مستوى الوقود، شكوى العميل، لمبات التحذير، محتويات السيارة (استبن، كوريك، مفتاح احتياطي...)، أماكن الخدوش والتلفيات، المتعلقات، عدد المفاتيح، موعد التسليم، **تصوير السيارة بكاميرا الموبايل**، طباعة إيصال استلام بتوقيع العميل |
| **تشخيص السيارة** | Diagnosis | جهاز الفحص (ISTA+ ...)، أكواد الأعطال، نتيجة الفحص، الإصلاحات المقترحة، التكلفة التقديرية، **إرسال التقدير للعميل على واتساب**، موافقة/رفض العميل، تحويل لأمر شغل |
| **داتا العملاء وسياراتهم** | Customers & vehicles | أفراد وشركات، أكثر من سيارة للعميل، رقم الشاسيه VIN، الفئة (3 Series, X5...)، كود الشاسيه (F30, G20...)، المحرك، العداد، الضمان، **سجل صيانة كامل لكل سيارة** (الشغل، القطع المركبة، الاستلامات، التشخيصات)، رصيد العميل |
| **أوامر الشغل** | Work orders | مصنعية من قائمة خدمات BMW أو يدوي، توزيع على الفنيين، قطع من المخزن (خصم تلقائي) أو قطع خارجية، الحالات: مفتوح ← جاري العمل ← بانتظار قطع/موافقة ← فحص جودة ← جاهزة ← تم التسليم، checklist فحص الجودة، صور، طباعة كارت الشغل، إرسال حالة السيارة للعميل |
| **تذكير الصيانات** | Service reminders | يتولد تلقائياً عند إنهاء أمر الشغل حسب نوع الخدمة (كل X كم / X شهر، مثل نظام CBS في BMW)، قائمة المستحق والمتأخر، **رسالة واتساب جاهزة**، اتصال، حجز موعد، تذكير يدوي |
| **الفواتير** | Invoices | فاتورة من أمر الشغل أو بيع قطع كاونتر، خصم، ضريبة القيمة المضافة (14% افتراضياً)، دفعات جزئية متعددة (نقدي/فيزا/تحويل/محفظة/شيك)، استرداد، إلغاء، طباعة فاتورة ثنائية اللغة، مشاركة على واتساب |
| **المخزون** | Inventory | كود القطعة ورقم BMW الأصلي، الاسم عربي/إنجليزي، التصنيف، مكان التخزين، حد الطلب وتنبيه النواقص، متوسط التكلفة المرجح، إضافة/صرف/جرد، سجل حركة المخزون |
| **الموردين الخارجيين** | Suppliers | بيانات المورد، فواتير المشتريات (تزود المخزن تلقائياً)، مرتجع مشتريات، السداد، **كشف حساب المورد** والرصيد المستحق |
| **الخزنة والحسابات** | Cash & accounting | أكثر من خزنة (نقدي، بنك، فيزا، محفظة)، تحصيلات الفواتير ومدفوعات الموردين تلقائياً، مصروفات بالتصنيف (إيجار، كهرباء، مرتبات...)، إيرادات أخرى، تحويل بين الخزائن، **تقفيل يومي** |
| **بونص الموظفين** | Staff bonuses | عمولة % على المصنعية و% على القطع لكل فني، **حاسبة العمولات** لأي فترة واعتمادها، بونص وخصومات/جزاءات، **المرتبات الشهرية** (أساسي + بونص - خصومات) وصرفها من الخزنة |
| التقارير | Reports | المبيعات، المصنعية، القطع، تكلفة القطع، **مجمل وصافي الربح**، المصروفات، المشتريات، المستحقات للعملاء وعليك للموردين، قيمة المخزون، أكثر الخدمات والقطع، حسب فئة السيارة، أداء الفنيين، حركة الخزائن |
| الإدارة | Administration | المستخدمين والصلاحيات، أنواع الخدمات وفترات التذكير، إعدادات المركز والشعار والضريبة، قوالب رسائل واتساب، **نسخة احتياطية**، سجل العمليات |

### الصلاحيات | Roles
- **مدير النظام (admin):** كل شيء + المستخدمين والإعدادات والنسخ الاحتياطي
- **مدير المركز (manager):** كل العمليات والحسابات والتقارير والموظفين
- **مستشار خدمة (advisor):** العملاء، السيارات، المواعيد، الاستلام، أوامر الشغل، الفواتير والتحصيل
- **فني (technician):** التشخيص وأوامر الشغل، بدون أسعار التكلفة أو الحسابات
- **محاسب (accountant):** الفواتير، الخزنة، الموردين، المشتريات، البونص والمرتبات، التقارير
- **أمين مخزن (storekeeper):** المخزون والحركة والموردين والمشتريات

### مميزات إضافية | Extras
- بحث سريع واحد بالـ لوحة / الشاسيه / اسم أو تليفون العميل / رقم الفاتورة / كود القطعة
- الوضع الليلي، تبديل اللغة بضغطة، واجهة RTL كاملة
- على الموبايل: قائمة سفلية، جداول تتحول لكروت، نوافذ من أسفل الشاشة، تصوير مباشر بالكاميرا
- تصدير أي قائمة إلى Excel (CSV)
- الطباعة: إيصال استلام، كارت شغل، فاتورة، كشف حساب مورد، تقفيل يومي، تقارير
- تسجيل كل عملية (من فعل ماذا ومتى)

---

## التقنية | Technical notes

- **Backend:** Node.js with zero dependencies (`node:http` plus the built-in `node:sqlite`). Code is in `server/`.
- **Frontend:** vanilla JS single-page app with an installable PWA (manifest plus service worker). Code is in `public/`.
- **Data:** stored in `data/gear.db` (SQLite). Uploaded photos go in `data/uploads/`. Back up the `data/` folder, or use *Settings → Download backup*.
- **Security:**
  - Passwords are hashed with scrypt.
  - Sessions use HttpOnly SameSite cookies.
  - Login attempts are rate-limited.
  - Permissions are enforced on the server for every endpoint.
  - Uploads are type-checked and served only to logged-in users.
- **Production:** run it on a PC or small server inside the center. For internet access, put it behind HTTPS, for example a reverse proxy such as Caddy or Nginx, or Cloudflare Tunnel. HTTPS is also needed for the "Install app" prompt on phones when you access the system by domain name.

```
service-center/
├── server/        db.js (schema + seed), server.js (API + business logic)
├── public/        index.html, css/, js/ (i18n, core, pages-*), sw.js, manifest
├── scripts/       demo-data.js
├── test/          api.test.js (end-to-end business flow)
└── data/          (created at runtime – database, uploads, backups)
```
