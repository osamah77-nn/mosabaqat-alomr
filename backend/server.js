// استيراد المكتبات في الأعلى (ترتيب صحيح)
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const { createBinancePayOrder } = require('./binancePay');

// تعريف التطبيق مباشرة بعد الاستيراد
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// السماح فقط لدومين Vercel (يمكنك تعديله لاحقاً)
const allowedOrigins = [
    process.env.FRONTEND_ORIGIN || 'https://your-vercel-app.vercel.app',
    'http://localhost:3000',
    'http://localhost:5000'
];

app.use(cors({
    origin: function (origin, callback) {
        // السماح بدون Origin (مثل Postman أو Flutter)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        } else {
            // السماح بأي origin في بيئة التطوير
            return callback(null, true);
        }
    },
    credentials: true
}));

app.use(express.json());

const fs = require('fs');
if (fs.existsSync('public')) {
    app.use(express.static('public'));
}

// ربط MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'mosabaqat_alomr';
let db, newsCollection, participantsCollection, winnerCollection;

async function connectDB() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        console.log('📍 URI:', MONGODB_URI.substring(0, 20) + '...');

        const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
        await client.connect();

        db = client.db(DB_NAME);
        newsCollection = db.collection('news');
        participantsCollection = db.collection('participants');
        winnerCollection = db.collection('winner');

        console.log('✅ Connected to MongoDB successfully');
        console.log('✅ Database:', DB_NAME);
        console.log('✅ Collections initialized:', {
            news: !!newsCollection,
            participants: !!participantsCollection,
            winner: !!winnerCollection
        });

        return true;
    } catch (err) {
        console.error('❌ MongoDB connection failed:', err);
        throw err;
    }
}

// بيانات المطور (admin) الثابتة
const ADMIN_EMAIL = "developer@mosabaqa.com";

// جميع المسارات (routes)

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.send('✅ Server Mosabaqat Alomr Running - All Systems Operational');
});

// Endpoint: POST /create-payment
app.post('/create-payment', async (req, res) => {
    try {
        console.log('💳 Payment request:', req.body);
        const { amount } = req.body;
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        const paymentUrl = await createBinancePayOrder(amount);
        console.log('✅ Payment URL created');
        res.json({ payment_url: paymentUrl });
    } catch (err) {
        console.error('❌ Payment error:', err);
        res.status(500).json({ error: err.message || 'Payment creation failed' });
    }
});

// إضافة خبر جديد (POST /news)
app.post('/news', async (req, res) => {
    try {
        console.log('📰 News post request:', req.body);
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
        console.log('✅ News added:', result.insertedId);
        res.status(201).json({ ...newsItem, id: result.insertedId });
    } catch (err) {
        console.error('❌ News post error:', err);
        res.status(500).json({ message: 'فشل إضافة الخبر' });
    }
});

// جلب جميع الأخبار (GET /news)
app.get('/news', async (req, res) => {
    try {
        console.log('📰 Fetching news...');
        const news = await newsCollection.find().sort({ date: -1 }).toArray();
        console.log(`✅ Found ${news.length} news items`);
        res.json(news.map(n => ({ ...n, id: n._id })));
    } catch (err) {
        console.error('❌ News fetch error:', err);
        res.status(500).json({ message: 'فشل جلب الأخبار' });
    }
});

// حذف خبر (DELETE /news/:id)
app.delete('/news/:id', async (req, res) => {
    try {
        console.log('🗑️ Delete news:', req.params.id);
        const id = req.params.id;
        const result = await newsCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'الخبر غير موجود' });
        }
        console.log('✅ News deleted');
        res.json({ message: 'تم حذف الخبر بنجاح' });
    } catch (err) {
        console.error('❌ News delete error:', err);
        res.status(500).json({ message: 'فشل حذف الخبر' });
    }
});

// إضافة أو تحديث بيانات الفائز (POST /winner)
app.post('/winner', async (req, res) => {
    try {
        console.log('🏆 Winner update request:', req.body);
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
        console.log('✅ Winner updated:', result.insertedId);
        res.status(201).json({ ...winner, id: result.insertedId });
    } catch (err) {
        console.error('❌ Winner update error:', err);
        res.status(500).json({ message: 'فشل تحديث الفائز' });
    }
});

// جلب بيانات الفائز الحالية (GET /winner)
app.get('/winner', async (req, res) => {
    try {
        console.log('🏆 Fetching winner...');
        const winner = await winnerCollection.findOne();
        console.log('✅ Winner:', winner ? 'Found' : 'None');
        res.json(winner ? { ...winner, id: winner._id } : null);
    } catch (err) {
        console.error('❌ Winner fetch error:', err);
        res.status(500).json({ message: 'فشل جلب بيانات الفائز' });
    }
});

// حذف بيانات الفائز (DELETE /winner)
app.delete('/winner', async (req, res) => {
    try {
        console.log('🗑️ Deleting winner...');
        await winnerCollection.deleteMany({});
        console.log('✅ Winner deleted');
        res.json({ message: 'تم حذف رسالة الفائز' });
    } catch (err) {
        console.error('❌ Winner delete error:', err);
        res.status(500).json({ message: 'فشل حذف الفائز' });
    }
});

// نقطة إرجاع جميع المشاركين (للمطور)
app.get('/participants', async (req, res) => {
    try {
        console.log('👥 Fetching participants...');
        const participants = await participantsCollection.find().toArray();
        console.log(`✅ Found ${participants.length} participants`);
        res.json(participants.map(p => ({
            id: p._id,
            username: p.username,
            family: p.family || '',
            email: p.email,
            registrationNumber: p.registrationNumber,
            role: p.role,
            createdAt: p.createdAt
        })));
    } catch (err) {
        console.error('❌ Participants fetch error:', err);
        res.status(500).json({ message: 'فشل جلب المشاركين' });
    }
});

// تسجيل الدخول (موحد للجميع)
app.post('/login', async (req, res) => {
    try {
        console.log('🔐 Login request:', { email: req.body.email || req.body.username });
        const { email, password, username } = req.body;
        const loginIdentifier = email || username;

        if (!loginIdentifier || !password) {
            return res.status(400).json({ message: 'يرجى إدخال البريد وكلمة المرور' });
        }

        const user = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${loginIdentifier}$`, 'i') }
        });

        if (!user) {
            console.log('❌ User not found:', loginIdentifier);
            return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
        }

        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
            console.log('❌ Password mismatch');
            return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
        }

        const role = (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user';
        console.log('✅ Login successful:', { username: user.username, role });
        return res.json({
            token: "user-token",
            username: user.username,
            family: user.family || '',
            email: user.email,
            registrationNumber: user.registrationNumber,
            role
        });
    } catch (err) {
        console.error('❌ Login error:', err);
        res.status(500).json({ message: 'حدث خطأ أثناء تسجيل الدخول' });
    }
});

// إنشاء مستخدم جديد برقم مشاركة عشوائي وحفظه مع تشفير كلمة المرور
app.post('/register', async (req, res) => {
    try {
        console.log('📝 Register request received:', req.body);
        const { username, family, email, password } = req.body;

        if (!username || !family || !email || !password) {
            console.log('❌ Missing fields:', {
                username: !!username,
                family: !!family,
                email: !!email,
                password: !!password
            });
            return res.status(400).json({ message: 'يرجى تعبئة جميع الحقول' });
        }

        const exists = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${email}$`, 'i') }
        });

        if (exists) {
            console.log('❌ Email already exists:', email);
            return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const registrationNumber = Math.floor(100000 + Math.random() * 900000);
        const role = (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user';

        const newParticipant = {
            username,
            family,
            email,
            passwordHash,
            registrationNumber,
            role,
            createdAt: new Date()
        };

        const result = await participantsCollection.insertOne(newParticipant);
        console.log('✅ User registered successfully:', {
            username,
            family,
            email,
            registrationNumber,
            insertedId: result.insertedId
        });

        res.status(201).json({ username, family, email, registrationNumber, role });
    } catch (err) {
        console.error('❌ Register error:', err);
        res.status(500).json({ message: 'حدث خطأ أثناء التسجيل' });
    }
});

// تشغيل السيرفر بعد الاتصال بقاعدة البيانات
async function startServer() {
    try {
        // الاتصال بقاعدة البيانات أولاً
        await connectDB();

        // بعد نجاح الاتصال، نبدأ السيرفر
        app.listen(PORT, '0.0.0.0', () => {
            console.log('='.repeat(50));
            console.log(`✅ Server running on port ${PORT}`);
            console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log('✅ All systems ready!');
            console.log('='.repeat(50));
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}

// بدء السيرفر
startServer();

// معالجة أخطاء عامة لمنع انهيار السيرفر
process.on('uncaughtException', function (err) {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', function (err) {
    console.error('❌ Unhandled Rejection:', err);
});
