// استيراد المكتبات في الأعلى
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');

// تعريف التطبيق مباشرة بعد الاستيراد
const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
// ...existing code...

// تخزين مؤقت للأخبار
let newsList = [];

// تخزين مؤقت لبيانات الفائز الحالي
let winnerData = null;

// تخزين مؤقت للمشاركين
// كل مستخدم: { username, email, passwordHash, registrationNumber, role }
let participants = [];

// بيانات المطور (admin) الثابتة
const ADMIN_EMAIL = "developer@mosabaqa.com";

// جميع المسارات (routes)
// إضافة خبر جديد (POST /news)
app.post('/news', (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) {
        return res.status(400).json({ message: 'العنوان والمحتوى مطلوبان' });
    }
    const newsItem = {
        id: Date.now(),
        title,
        content,
        date: new Date().toISOString()
    };
    newsList.unshift(newsItem); // أحدث خبر أولاً
    res.status(201).json(newsItem);
});


// جلب جميع الأخبار (GET /news)
app.get('/news', (req, res) => {
    res.json(newsList);
});

// حذف خبر (DELETE /news/:id)
app.delete('/news/:id', (req, res) => {
    const id = req.params.id;
    const before = newsList.length;
    newsList = newsList.filter(item => String(item.id) !== String(id));
    if (newsList.length === before) {
        return res.status(404).json({ message: 'الخبر غير موجود' });
    }
    res.json({ message: 'تم حذف الخبر بنجاح' });
});

// إضافة أو تحديث بيانات الفائز (POST /winner)
app.post('/winner', (req, res) => {
    const { name, number, amount } = req.body;
    if (!name || !number || !amount) {
        return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
    }
    winnerData = {
        id: Date.now(),
        name,
        number,
        amount,
        date: new Date().toISOString()
    };
    res.status(201).json(winnerData);
});

// جلب بيانات الفائز الحالية (GET /winner)
app.get('/winner', (req, res) => {
    if (!winnerData) return res.json(null);
    res.json(winnerData);
});

// حذف بيانات الفائز (DELETE /winner)
app.delete('/winner', (req, res) => {
    winnerData = null;
    res.json({ message: 'تم حذف رسالة الفائز' });
});

// نقطة إرجاع جميع المشاركين (للمطور)
app.get('/participants', (req, res) => {
    res.json(participants);
});


// تسجيل الدخول (موحد للجميع)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'يرجى إدخال البريد وكلمة المرور' });
    }
    const user = participants.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
        return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
        return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }
    // تحديد الدور بناءً على الإيميل
    const role = (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user';
    // إرسال توكن بسيط (يمكنك لاحقاً استبداله بـ JWT)
    return res.json({ token: "user-token", username: user.username, role });
});

app.get('/', (req, res) => {
    res.send('Server Mosabaqat Alomr Running');
});

// إنشاء مستخدم جديد برقم مشاركة عشوائي وحفظه مع تشفير كلمة المرور
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).send({ message: 'يرجى تعبئة جميع الحقول' });
    }
    if (participants.find(u => u.email && u.email.toLowerCase() === email.toLowerCase())) {
        return res.status(400).send({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const registrationNumber = Math.floor(100000 + Math.random() * 900000);
    const role = (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user';
    const newParticipant = { username, email, passwordHash, registrationNumber, role };
    participants.push(newParticipant);
    res.status(201).json({ username, email, registrationNumber, role });
});

// تشغيل السيرفر في النهاية
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});