// استيراد المكتبات في الأعلى
const express = require('express');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
require('dotenv').config();
const { createBinancePayOrder } = require('./binancePay');
// تعريف التطبيق مباشرة بعد الاستيراد
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// السماح فقط لدومين Vercel (يمكنك تعديله لاحقاً)
const allowedOrigins = [process.env.FRONTEND_ORIGIN || 'https://your-vercel-app.vercel.app'];
app.use(cors({
    origin: function (origin, callback) {
        // السماح بدون Origin (مثل Postman)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        } else {
            return callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));
// ...existing code...
// Endpoint: POST /create-payment
app.post('/create-payment', async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        const paymentUrl = await createBinancePayOrder(amount);
        res.json({ payment_url: paymentUrl });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Payment creation failed' });
    }
});

// تخزين مؤقت للأخبار
// ربط MongoDB
const { MongoClient, ObjectId } = require('mongodb');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'mosabaqat_alomr';
let db, newsCollection, participantsCollection, winnerCollection;

async function connectDB() {
    const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await client.connect();
    db = client.db(DB_NAME);
    newsCollection = db.collection('news');
    participantsCollection = db.collection('participants');
    winnerCollection = db.collection('winner');
    console.log('Connected to MongoDB');
}
connectDB().catch(console.error);

// بيانات المطور (admin) الثابتة
const ADMIN_EMAIL = "developer@mosabaqa.com";

// جميع المسارات (routes)
// إضافة خبر جديد (POST /news)
app.post('/news', async (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) {
        return res.status(400).json({ message: 'العنوان والمحتوى مطلوبان' });
    }
    const newsItem = {
        title,
        content,
        date: new Date().toISOString()
    };
    const result = await newsCollection.insertOne(newsItem);
    res.status(201).json({ ...newsItem, id: result.insertedId });
});


// جلب جميع الأخبار (GET /news)
app.get('/news', async (req, res) => {
    const news = await newsCollection.find().sort({ date: -1 }).toArray();
    res.json(news.map(n => ({ ...n, id: n._id })));
});

// حذف خبر (DELETE /news/:id)
app.delete('/news/:id', async (req, res) => {
    const id = req.params.id;
    const result = await newsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
        return res.status(404).json({ message: 'الخبر غير موجود' });
    }
    res.json({ message: 'تم حذف الخبر بنجاح' });
});

// إضافة أو تحديث بيانات الفائز (POST /winner)
app.post('/winner', async (req, res) => {
    const { name, number, amount } = req.body;
    if (!name || !number || !amount) {
        return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
    }
    const winner = {
        name,
        number,
        amount,
        date: new Date().toISOString()
    };
    await winnerCollection.deleteMany({}); // winner واحد فقط
    const result = await winnerCollection.insertOne(winner);
    res.status(201).json({ ...winner, id: result.insertedId });
});

// جلب بيانات الفائز الحالية (GET /winner)
app.get('/winner', async (req, res) => {
    const winner = await winnerCollection.findOne();
    res.json(winner ? { ...winner, id: winner._id } : null);
});

// حذف بيانات الفائز (DELETE /winner)
app.delete('/winner', async (req, res) => {
    await winnerCollection.deleteMany({});
    res.json({ message: 'تم حذف رسالة الفائز' });
});

// نقطة إرجاع جميع المشاركين (للمطور)
app.get('/participants', async (req, res) => {
    const participants = await participantsCollection.find().toArray();
    res.json(participants.map(p => ({ ...p, id: p._id })));
});


// تسجيل الدخول (موحد للجميع)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'يرجى إدخال البريد وكلمة المرور' });
    }
    const user = await participantsCollection.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
    if (!user) {
        return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
        return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }
    const role = (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user';
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
    const exists = await participantsCollection.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
    if (exists) {
        return res.status(400).send({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const registrationNumber = Math.floor(100000 + Math.random() * 900000);
    const role = (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user';
    const newParticipant = { username, email, passwordHash, registrationNumber, role };
    await participantsCollection.insertOne(newParticipant);
    res.status(201).json({ username, email, registrationNumber, role });
});

// تشغيل السيرفر في النهاية
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});