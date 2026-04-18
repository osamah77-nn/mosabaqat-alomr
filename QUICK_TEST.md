# 🧪 اختبار سريع للمشروع

## ✅ الخطوات السريعة للتحقق من عمل كل شيء

---

### 1️⃣ اختبار السيرفر

```bash
curl https://the-contest-of-a-lifetime-2wuc.onrender.com
```

**النتيجة المتوقعة:**
```
✅ Server Mosabaqat Alomr Running - All Systems Operational
```

---

### 2️⃣ اختبار التسجيل

```bash
curl -X POST https://the-contest-of-a-lifetime-2wuc.onrender.com/register \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"Test User\",\"email\":\"test@example.com\",\"password\":\"test123\"}"
```

**النتيجة المتوقعة:**
```json
{
  "username": "Test User",
  "email": "test@example.com",
  "registrationNumber": 123456,
  "role": "user"
}
```

---

### 3️⃣ اختبار جلب المشاركين

```bash
curl https://the-contest-of-a-lifetime-2wuc.onrender.com/participants
```

**النتيجة المتوقعة:**
```json
[
  {
    "username": "Test User",
    "email": "test@example.com",
    "registrationNumber": 123456,
    "role": "user",
    "id": "..."
  }
]
```

---

### 4️⃣ اختبار تسجيل الدخول

```bash
curl -X POST https://the-contest-of-a-lifetime-2wuc.onrender.com/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"developer@mosabaqa.com\",\"password\":\"devpass2026\"}"
```

**النتيجة المتوقعة:**
```json
{
  "token": "user-token",
  "username": "developer",
  "role": "admin"
}
```

---

### 5️⃣ اختبار الأخبار

**إضافة خبر:**
```bash
curl -X POST https://the-contest-of-a-lifetime-2wuc.onrender.com/news \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"خبر تجريبي\",\"content\":\"هذا خبر للاختبار\"}"
```

**جلب الأخبار:**
```bash
curl https://the-contest-of-a-lifetime-2wuc.onrender.com/news
```

---

### 6️⃣ اختبار الفائز

**تحديد فائز:**
```bash
curl -X POST https://the-contest-of-a-lifetime-2wuc.onrender.com/winner \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"أحمد محمد\",\"number\":\"123456\",\"amount\":\"1000\"}"
```

**جلب الفائز:**
```bash
curl https://the-contest-of-a-lifetime-2wuc.onrender.com/winner
```

---

### 7️⃣ اختبار الدفع (Binance Pay)

```bash
curl -X POST https://the-contest-of-a-lifetime-2wuc.onrender.com/create-payment \
  -H "Content-Type: application/json" \
  -d "{\"amount\":10}"
```

**النتيجة المتوقعة:**
```json
{
  "payment_url": "https://pay.binance.com/..."
}
```

---

## 📱 اختبار Flutter App

### 1. تشغيل التطبيق:
```bash
cd frontend
flutter pub get
flutter run
```

### 2. اختبار التسجيل:
- ✅ أدخل الاسم الكامل
- ✅ أدخل البريد الإلكتروني
- ✅ أدخل كلمة المرور
- ✅ اضغط "تسجيل"
- ✅ يجب أن تحصل على رقم مشاركة

### 3. اختبار لوحة المطور:
- ✅ اضغط "تسجيل دخول المطور"
- ✅ Email: `developer@mosabaqa.com`
- ✅ Password: `devpass2026`
- ✅ يجب أن ترى جميع المشاركين
- ✅ يجب أن ترى المستخدم الذي سجلته للتو

### 4. اختبار الأخبار:
- ✅ في لوحة المطور، أضف خبر جديد
- ✅ ارجع للصفحة الرئيسية
- ✅ يجب أن يظهر الخبر

### 5. اختبار الفائز:
- ✅ في لوحة المطور، حدد فائز
- ✅ ارجع للصفحة الرئيسية
- ✅ يجب أن تظهر رسالة الفائز

---

## ✅ قائمة التحقق السريعة

- [ ] السيرفر يعمل على Render
- [ ] التسجيل يحفظ البيانات
- [ ] المشاركين يظهرون في لوحة المطور
- [ ] تسجيل الدخول يعمل
- [ ] الأخبار تُنشر وتظهر
- [ ] الفائز يُحدث ويظهر
- [ ] الدفع ينشئ رابط Binance Pay

---

## 🔍 فحص Logs على Render

1. اذهب إلى Render Dashboard
2. اختر المشروع
3. اضغط على "Logs"
4. ابحث عن:

```
✅ Connected to MongoDB successfully
✅ Collections initialized
✅ Server running on port 5000
✅ All systems ready!
```

عند التسجيل يجب أن ترى:
```
📝 Register request received: { username: '...', email: '...', password: '...' }
✅ User registered successfully: { username: '...', email: '...', registrationNumber: 123456 }
```

عند جلب المشاركين:
```
👥 Fetching participants...
✅ Found 5 participants
```

عند الدفع:
```
💳 Creating Binance Pay order...
💵 Amount: 10 USDT
📤 Sending request to Binance Pay...
📥 Response status: SUCCESS
✅ Payment URL created: https://...
```

---

## ❌ إذا واجهت مشكلة

### المشكلة: التسجيل لا يعمل
**الحل:**
1. تحقق من Logs: هل يصل الطلب للسيرفر؟
2. تحقق من MongoDB: هل الاتصال يعمل؟
3. تحقق من Flutter: هل الرابط صحيح في config.dart؟

### المشكلة: المشاركين لا يظهرون
**الحل:**
1. تحقق من أن التسجيل نجح أولاً
2. تحقق من Logs عند جلب المشاركين
3. تحقق من أن لوحة المطور تستخدم نفس الرابط

### المشكلة: الدفع لا يعمل
**الحل:**
1. تحقق من Binance API Keys في .env
2. تحقق من Logs: ماذا يقول Binance Pay؟
3. تأكد من أن حسابك مفعل على Binance Pay

---

**آخر تحديث:** 2024
**الحالة:** ✅ جميع الاختبارات جاهزة
