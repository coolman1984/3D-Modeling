# 🧱 خطة النواة الصافية

**الإصدار الأول — ٢٥ سبتمبر ٢٠٢٦**

الخطة الرئيسية (`01-master-plan.md`) هي **الوجهة البعيدة**. الوثيقة دي هي **أول خطوة فعلية**: نواة صغيرة، صافية، مختبرة، نقدر نبني فوقها بعدين الرسم والمجسم والخادم والحزم من غير ما نهدها.

---

## 1. يعني إيه «نواة صافية»؟ 🎯

مكتبة حسابات بس. بتاخد بيانات وترجع بيانات. **مفيش شاشة، مفيش خادم، مفيش قاعدة بيانات، مفيش رسم.**

بتجاوب على خمس أسئلة بس:

1. 📐 **المكان ده شكله إيه ومقاساته كام؟**
2. 🪑 **فيه عناصر إيه، وكل واحد فين وبأي اتجاه؟**
3. ✋ **لو حركت/لفّيت/أضفت/مسحت حاجة، الحالة الجديدة إيه؟ وأرجع إزاي؟**
4. 🚦 **فيه مشاكل؟** (خارج الحدود، تداخل، سادد باب، خلوص ناقص)
5. 📊 **الأرقام كام؟** (عدد، مساحة، نسبة إشغال، كراسي)

وتقدر **تتحفظ في ملف وتتفتح تاني بنفس الأرقام بالظبط**.

### قواعد لا تُكسر ⛔

| القاعدة | السبب |
|---|---|
| النواة متستوردش أي مكتبة رسم أو واجهة أو خادم | عشان تشتغل في المتصفح والخادم والاختبارات بنفس الشكل |
| صفر اعتماديات خارجية وقت التشغيل | أمان وسهولة وثبات؛ أي مكتبة تدخل بقرار مكتوب |
| دوال نقية: نفس المدخل ← نفس المخرج | مفيش `Date.now()` ولا `Math.random()` جوه النواة؛ المعرفات والوقت بتيجي من بره |
| الحالة لا تتعدل مباشرة | أي تغيير = أمر ← حالة جديدة + أمر عكسي |
| الأطوال أعداد صحيحة | مفيش تراكم كسور؛ الحفظ والفتح يرجعوا نفس الرقم |
| الأنشطة (قاعات/مكاتب/مخازن) مش جوه النواة | النواة متعرفش يعني إيه «كرسي فرح»؛ تعرف «عنصر له بصمة وخلوص» |

---

## 2. القرارات التأسيسية 📏

```text
Language:        TypeScript (strict), ES modules
Runtime deps:    none
Dev tools:       Vitest + fast-check (property tests)
Package manager: pnpm workspaces (single package at first: packages/core)

Length:   integer ticks, 1 tick = 0.1 mm   (1 m = 10_000 ticks)
Angle:    integer millidegrees, CCW about +Z, normalized to [0, 360_000)
Axes:     right-handed, X east, Y north, Z up; plan = X-Y plane
Area:     reported in m² (float) at the output edge only
Tolerance: 2 ticks (0.2 mm) for geometric comparisons
World range: |coordinate| <= 10_000_000 ticks (1 km)
```

- ✅ الحسابات الداخلية (دوران، تقاطع) ممكن تبقى عشرية، لكن **أي حاجة بتتخزن في الحالة بتتقرّب لعدد صحيح**.
- ✅ تحويل الوحدات للعرض (متر، سنتي، قدم، بوصة) دوال منفصلة على الحافة، مش جوه الحالة.
- ⏳ **مكتبة المضلعات المتقدمة (قص واتحاد وإزاحة) مؤجلة.** في النسخة الأولى كل البصمات مستطيلات مدوّرة (مضلعات محدبة)، والمساحة مضلع بسيط بزوايا قائمة أو مائلة. ده كفاية لقاعة أو مكتب. نضيف المكتبة لما نحتاج اتحاد مساحات حقيقي، وخلف واجهة `GeometryPort` عشان متتغيرش بقية النواة.

---

## 3. نموذج البيانات الأول 🗃️

صغير عمدًا. كل حاجة فيه لها معرف ثابت.

```ts
type Id = string;              // generated outside the core
type Tick = number;            // integer, 0.1 mm
type MilliDeg = number;        // integer
type Vec2 = { x: Tick; y: Tick };

interface Project {
  schemaVersion: 1;
  id: Id;
  name: string;
  revision: number;            // +1 on every accepted command
  space: Space;
  catalog: Record<Id, ItemDefinition>;
  items: Record<Id, ItemInstance>;
}

interface Space {
  boundary: Vec2[];            // simple polygon, CCW, no self-intersection
  obstacles: Obstacle[];       // columns, blocked zones
  doors: Door[];
  ceilingHeight?: Tick;        // missing => height checks are "unknown"
}

interface Obstacle { id: Id; kind: 'column' | 'blocked-zone'; polygon: Vec2[]; }

interface Door {
  id: Id;
  hinge: Vec2;                 // hinge point on the boundary
  width: Tick;
  angle: MilliDeg;             // direction of the closed leaf
  swing: 'left' | 'right';     // side of the 90° opening sector
}

interface ItemDefinition {
  id: Id;
  name: string;
  category: string;            // free tag; meaning belongs to packs
  size: { w: Tick; d: Tick; h: Tick };
  clearance: { front: Tick; back: Tick; left: Tick; right: Tick };
  seats?: number;              // capacity contribution, optional
}

interface ItemInstance {
  id: Id;
  definitionId: Id;
  position: Vec2;              // footprint centre
  rotation: MilliDeg;
  locked: boolean;
}
```

**ليه كده؟**

- 🪑 **التعريف منفصل عن النسخة**: ١٠٠ كرسي = تعريف واحد + ١٠٠ موضع. تعديل مقاس الكرسي مرة واحدة.
- 🧭 **الخلوص بيلف مع العنصر**: الخلوص «قدام/ورا/يمين/شمال» نسبي للعنصر نفسه.
- ❓ **غياب البيانات = «غير معروف» مش «ناجح»**: لو ارتفاع السقف مش مكتوب، فحص الارتفاع يطلع «غير مكتمل».
- 🚪 **الجدران الكاملة (عقد وحواف وسمك) مؤجلة للمرحلة ج٨.** دلوقتي المساحة حدود مضلع + أبواب على الحدود. ده يغطي قاعة أو مكتب واحد، وميقفلش الطريق.

---

## 4. وحدات النواة 🧩

```text
packages/core/src/
  units/        ticks, angles, conversions, validation of ranges
  geometry/     vec2, polygon (area, orientation, contains, simple?),
                obb (rotated rect -> polygon), SAT overlap, distances,
                door swing sector, AABB
  model/        types, factories, invariants (validateProject)
  commands/     command types, apply(), inverse, batch, History (undo/redo)
  checks/       out-of-bounds, overlap, clearance, door-swing,
                obstacle, height -> Issue[]
  metrics/      counts per definition, seats, area, occupied %, BOM
  io/           serialize/deserialize, schemaVersion, migrations
  index.ts      the ONLY public entry point
```

**اتجاه الاعتماد (ممنوع العكس):**

```text
units  <-  geometry  <-  model  <-  commands
                           ^           
                           +---- checks, metrics, io
```

### الأوامر ↩️

```ts
type Command =
  | { type: 'item.add';    item: ItemInstance }
  | { type: 'item.move';   id: Id; to: Vec2 }
  | { type: 'item.rotate'; id: Id; to: MilliDeg }
  | { type: 'item.remove'; id: Id }
  | { type: 'item.lock';   id: Id; locked: boolean }
  | { type: 'catalog.define'; definition: ItemDefinition }
  | { type: 'space.set';   space: Space }
  | { type: 'batch';       commands: Command[] };

type Outcome =
  | { ok: true;  project: Project; inverse: Command }
  | { ok: false; reason: RejectReason };

apply(project: Project, cmd: Command): Outcome
```

- الأمر بيترفض لو هيكسر **سلامة البيانات** (معرف مكرر، مرجع مكسور، مقاس سالب، عنصر مقفول).
- الأمر **مش** بيترفض عشان تداخل أو خلوص ناقص؛ دي «مشاكل تصميم» بتظهر في الفحص، والمستخدم يقرر.
- الدفعة ذرية: يا كلها تنجح يا ولا حاجة.
- `History` بسيط: قائمتين (رجوع/إعادة)، وأي أمر جديد يمسح قائمة الإعادة.

### الفحوص 🚦

```ts
interface Issue {
  code: 'out-of-bounds' | 'overlap' | 'clearance' | 'door-blocked'
      | 'obstacle' | 'too-tall' | 'height-unknown';
  severity: 'error' | 'warning' | 'info';
  entityIds: Id[];
  measured?: Tick;             // e.g. actual gap
  required?: Tick;             // e.g. required clearance
  evidence?: Vec2[];           // polygon to highlight
}

checkProject(project: Project): Issue[]
```

- الفحص ثلاث درجات: صناديق محاذية للمحاور ترشح البعيد ← مستطيلات مدوّرة بمحاور الفصل ← نتيجة بالرقم.
- في البداية فحص كل الأزواج مقبول لحد ~١٠٠٠ عنصر؛ الفهرس المكاني (شبكة أو شجرة) نضيفه لما القياس يقول.
- الرسالة لازم تقول **الرقم**: «ناقص ١٨٠ مم خلف العنصر»، مش «فيه مشكلة».

---

## 5. مراحل البناء خطوة خطوة 🛤️

كل مرحلة صغيرة، ليها **تعريف إنجاز** واضح. مفيش مرحلة تبدأ قبل ما اللي قبلها تعدي.

| المرحلة | المحتوى | تعريف الإنجاز ✅ |
|---|---|---|
| **ج٠ — التجهيز** | مستودع، `packages/core`، TypeScript صارم، Vitest، فحص نوع وتنسيق، تكامل مستمر | `pnpm test` و`pnpm typecheck` خضرا على جهاز نظيف وفي التكامل المستمر |
| **ج١ — الوحدات** | ticks، زوايا، تحويلات مم/سم/م/قدم/بوصة، رفض القيم غير الصالحة | تحويل ذهاب وإياب بدون فقد (اختبار خصائص)؛ زاوية ٣٦٠ = صفر؛ ‎NaN‎ واللانهاية مرفوضين |
| **ج٢ — الهندسة** | متجهات، مساحة مضلع واتجاهه، احتواء نقطة ومضلع، مستطيل مدوّر ← مضلع، تداخل بمحاور الفصل، مسافة بين مضلعين، قطاع فتح الباب | حالات مرجعية مرسومة باليد + اختبارات خصائص (الدوران ميغيرش المساحة، التداخل متماثل) |
| **ج٣ — النموذج** | الأنواع، دوال الإنشاء، `validateProject` لسلامة البيانات | مشروع فاسد (مرجع مكسور، مقاس سالب، مضلع متقاطع) بيترفض برسالة واضحة |
| **ج٤ — الأوامر والتراجع** | `apply`، الأمر العكسي، الدفعة الذرية، `History` | اختبار خصائص: ١٠٠ أمر عشوائي ثم تراجع الكل = المشروع الأصلي بالظبط؛ دفعة فيها أمر فاشل متغيرش حاجة |
| **ج٥ — الفحوص** | خارج الحدود، تداخل، خلوص، سد باب، عمود، ارتفاع | سيناريوهات مرجعية: قاعة ١٠×٨ م فيها ترابيزات وكراسي وباب وعمود ← قائمة مشاكل متوقعة بالأرقام |
| **ج٦ — الأرقام** | عدد لكل تعريف، كراسي، مساحة أرض، مساحة مشغولة، نسبة، قائمة كميات | أرقام السيناريو المرجعي مطابقة لحساب يدوي |
| **ج٧ — الحفظ والفتح** | `serialize`/`deserialize`، `schemaVersion`، مكان للترحيل | حفظ ← فتح ← حفظ = نفس النص بالظبط؛ ملف بإصدار أعلى يترفض بوضوح |

**بعد ج٧ عندنا نواة كاملة صغيرة** 🎉 تقدر تستخدمها من سطر أوامر أو اختبار لتمثيل قاعة حقيقية وفحصها وحساب أرقامها.

### اللي بعد النواة (بالترتيب) 🔭

| المرحلة | إيه | ليه في المكان ده |
|---|---|---|
| ج٨ | جدران بسمك وفتحات مرتبطة بالجدار | لما نحتاج أكتر من غرفة |
| ت١ | محرر ثنائي في المتصفح (رسم علوي) بيستخدم النواة بالأوامر بس | أول شاشة؛ مستخدم حقيقي يجرب |
| ت٢ | عرض مجسم خفيف لنفس البيانات | عرض على العميل |
| ت٣ | حزمة قاعات: كتالوج ٢٠–٣٠ عنصر + قواعد + تقرير | أول قيمة بيع |
| ت٤ | حزمة مكتب صغيرة من غير تعديل النواة | إثبات إن الأساس عام |
| ~~ت٥~~ | ~~خادم حفظ، حسابات، شركات~~ | **اتأجلت لـ ت١١** (تحديث ٢٥ سبتمبر ٢٠٢٦) |

### إضافات النواة للمرحلة الصناعية (تحديث ٢٥ سبتمبر ٢٠٢٦) 🏭

| المرحلة | إيه يدخل النواة | ليه |
|---|---|---|
| ت٥ | فهرس مكاني مشتق (شبكة منتظمة) مش بيتحفظ؛ وزن التعريف `mass` بالجرام؛ اتجاه العنصر `tilt` (أنهي وش لفوق)؛ بيانات حرة `meta` الحزمة بس اللي بتفهمها | مخازن ومصانع فيها آلاف العناصر؛ الحاويات محتاجة وزن وقلب الكرتونة على جنبها |
| ت٧ | مناطق مسماة `Space.zones` (مضلع + نوع حر) و`GeometryPort` لاتحاد وإزاحة المضلعات | المخازن أول حزمة محتاجاها |

كل الإضافات اختيارية: الملفات القديمة بتتفتح وتتحفظ بنفس النص بالظبط. التفاصيل في `03-industrial-packs-plan.md`.

---

## 6. حراسة الجودة 🧪

- 🔒 **النواة ممنوع تستورد** أي حاجة من خارج `packages/core` (قاعدة فحص آلية).
- 🧮 **اختبارات خصائص** لكل عملية هندسية وكل أمر (مش أمثلة بس).
- 📌 **سيناريوهات مرجعية** محفوظة كملفات مشروع، ونتيجتها المتوقعة محفوظة جنبها.
- 🚫 **ممنوع دمج** تغيير يكسر فتح ملف مشروع قديم.
- 📝 **أي قرار معماري جديد** يتكتب في `docs/decisions/` قبل تنفيذه.

---

## 7. اللي مش هنعمله دلوقتي ✂️

شاشات • خادم • حسابات وشركات • مساعد ذكي • ترتيب تلقائي • استيراد رسومات هندسية • جدران منحنية • عدة أدوار • رفع مجسمات • تسعير.

كل ده مكانه محفوظ في الخطة الرئيسية، ومش هيتعطل بسبب النواة؛ بالعكس، النواة هي اللي هتخليه ممكن.

---

## 8. أول خطوة عملية 🔨

**المرحلة ج٠ + ج١**: تجهيز المستودع ووحدات القياس مع اختباراتها. شغل يوم أو اتنين، وبعده كل مرحلة بتتبني على اللي قبلها.
