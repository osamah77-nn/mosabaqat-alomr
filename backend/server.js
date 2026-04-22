// استيراد المكتبات في الأعلى (ترتيب صحيح)
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

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

app.use(express.json({ limit: '25mb' }));

const uploadsRootDir = path.join(__dirname, 'uploads');
const paymentUploadsDir = path.join(uploadsRootDir, 'payments');
fs.mkdirSync(paymentUploadsDir, { recursive: true });

if (fs.existsSync(path.join(__dirname, 'public'))) {
    app.use(express.static(path.join(__dirname, 'public')));
}
app.use('/uploads', express.static(uploadsRootDir));

const paymentUpload = multer({
    storage: multer.diskStorage({
        destination: function (_req, _file, cb) {
            cb(null, paymentUploadsDir);
        },
        filename: function (_req, file, cb) {
            const originalExt = path.extname(file.originalname || '').toLowerCase();
            const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(originalExt) ? originalExt : '.jpg';
            cb(null, `payment-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
        }
    }),
    limits: {
        fileSize: 2 * 1024 * 1024
    },
    fileFilter: function (_req, file, cb) {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            cb(new Error('INVALID_PAYMENT_IMAGE_TYPE'));
            return;
        }
        cb(null, true);
    }
});

function removeUploadedPaymentProof(filePath) {
    if (!filePath) return;
    fs.unlink(filePath, function () { });
}

function buildStoredPaymentProofPath(filename) {
    return `/uploads/payments/${filename}`;
}

function getPaymentProofExtensionFromMime(mimeType) {
    switch (String(mimeType || '').toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
            return '.jpg';
        case 'image/png':
            return '.png';
        case 'image/webp':
            return '.webp';
        case 'image/gif':
            return '.gif';
        default:
            return '.jpg';
    }
}

function normalizePaymentProofPath(payment) {
    if (payment && typeof payment.proofImage === 'string' && payment.proofImage.startsWith('/uploads/payments/')) {
        return payment.proofImage;
    }
    if (payment && payment.proofImageFilename) {
        return buildStoredPaymentProofPath(payment.proofImageFilename);
    }
    return '';
}

async function ensurePaymentsIndexes() {
    await paymentsCollection.createIndex({ createdAt: -1 }, { name: 'payments_createdAt_desc' });
    await paymentsCollection.createIndex({ status: 1, createdAt: -1 }, { name: 'payments_status_createdAt_desc' });
}

async function migrateLegacyPaymentProofs() {
    const cursor = paymentsCollection.find(
        {
            proofImage: {
                $type: 'string',
                $regex: /^data:image\//
            }
        },
        {
            projection: {
                proofImage: 1,
                proofImageFilename: 1
            }
        }
    );

    let migratedCount = 0;
    let removedCount = 0;

    for await (const payment of cursor) {
        const legacyProof = String(payment.proofImage || '');
        const match = legacyProof.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

        if (!match) {
            await paymentsCollection.updateOne(
                { _id: payment._id },
                {
                    $set: {
                        proofImage: '',
                        proofImageFilename: ''
                    }
                }
            );
            removedCount += 1;
            continue;
        }

        try {
            const mimeType = match[1];
            const base64Data = match[2];
            const extension = getPaymentProofExtensionFromMime(mimeType);
            const filename = payment.proofImageFilename || `legacy-payment-${payment._id}${extension}`;
            const filePath = path.join(paymentUploadsDir, filename);
            await fs.promises.writeFile(filePath, Buffer.from(base64Data, 'base64'));

            await paymentsCollection.updateOne(
                { _id: payment._id },
                {
                    $set: {
                        proofImage: buildStoredPaymentProofPath(filename),
                        proofImageFilename: filename
                    }
                }
            );
            migratedCount += 1;
        } catch (err) {
            console.error('❌ Legacy payment proof migration failed:', payment._id, err.message);
            await paymentsCollection.updateOne(
                { _id: payment._id },
                {
                    $set: {
                        proofImage: '',
                        proofImageFilename: ''
                    }
                }
            );
            removedCount += 1;
        }
    }

    if (migratedCount || removedCount) {
        console.log(`💳 Legacy payment proofs handled: migrated=${migratedCount}, removed=${removedCount}`);
    }
}

// ربط MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'mosabaqat_alomr';
let db, newsCollection, participantsCollection, winnerCollection, paymentsCollection;

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
        paymentsCollection = db.collection('payments');
        await ensurePaymentsIndexes();
        await migrateLegacyPaymentProofs();

        console.log('✅ Connected to MongoDB successfully');
        console.log('✅ Database:', DB_NAME);
        console.log('✅ Collections initialized:', {
            news: !!newsCollection,
            participants: !!participantsCollection,
            winner: !!winnerCollection,
            payments: !!paymentsCollection
        });

        return true;
    } catch (err) {
        console.error('❌ MongoDB connection failed:', err);
        throw err;
    }
}

// بيانات المطور (admin) الثابتة
const ADMIN_EMAIL = "developer@mosabaqa.com";
const ADMIN_PASSWORD = "devpass2026";

function getParticipantNumbers(participant) {
    if (Array.isArray(participant?.ticketNumbers)) {
        return participant.ticketNumbers
            .map(n => String(n).trim())
            .filter(Boolean);
    }

    if (participant?.registrationNumber) {
        return [String(participant.registrationNumber).trim()].filter(Boolean);
    }

    return [];
}

function buildParticipantResponse(participant) {
    const ticketNumbers = getParticipantNumbers(participant);
    return {
        id: participant._id,
        username: participant.username,
        family: participant.family || '',
        email: participant.email,
        registrationNumber: ticketNumbers[0] || null,
        ticketNumbers,
        prizeAddress: participant.prizeAddress || '',
        messages: Array.isArray(participant.messages) ? participant.messages : [],
        role: participant.role,
        createdAt: participant.createdAt
    };
}

async function generateUniqueTicketNumbers(count) {
    const participants = await participantsCollection.find(
        {},
        { projection: { registrationNumber: 1, ticketNumbers: 1 } }
    ).toArray();

    const usedNumbers = new Set();
    participants.forEach(participant => {
        getParticipantNumbers(participant).forEach(number => usedNumbers.add(number));
    });

    const generated = [];
    while (generated.length < count) {
        const candidate = String(Math.floor(100000000 + Math.random() * 900000000));
        if (usedNumbers.has(candidate)) {
            continue;
        }
        usedNumbers.add(candidate);
        generated.push(candidate);
    }

    return generated;
}

// جميع المسارات (routes)

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.send('✅ Server Mosabaqat Alomr Running - All Systems Operational');
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
        const adminEmail = String(req.headers['x-admin-email'] || '').toLowerCase();
        const adminPassword = String(req.headers['x-admin-password'] || '');
        if (adminEmail !== ADMIN_EMAIL.toLowerCase() || adminPassword !== ADMIN_PASSWORD) {
            return res.status(403).json({ message: 'غير مصرح لك بالوصول إلى قائمة المشاركين' });
        }

        console.log('👥 Fetching participants...');
        const participants = await participantsCollection.find().toArray();
        console.log(`✅ Found ${participants.length} participants`);
        res.json(participants.map(buildParticipantResponse));
    } catch (err) {
        console.error('❌ Participants fetch error:', err);
        res.status(500).json({ message: 'فشل جلب المشاركين' });
    }
});

// إرجاع جميع طلبات الدفع للمطور فقط
app.get('/payments', async (req, res) => {
    try {
        const adminEmail = String(req.headers['x-admin-email'] || '').toLowerCase();
        const adminPassword = String(req.headers['x-admin-password'] || '');
        if (adminEmail !== ADMIN_EMAIL.toLowerCase() || adminPassword !== ADMIN_PASSWORD) {
            return res.status(403).json({ message: 'غير مصرح لك بالوصول إلى طلبات الدفع' });
        }

        console.log('💳 GET /payments request received');

        const payments = await paymentsCollection
            .find(
                {},
                {
                    projection: {
                        username: 1,
                        email: 1,
                        amount: 1,
                        quantity: 1,
                        paymentMethod: 1,
                        paymentTarget: 1,
                        proofImage: 1,
                        proofImageFilename: 1,
                        status: 1,
                        createdAt: 1,
                        rejectionReason: 1,
                        grantedCount: 1
                    }
                }
            )
            .sort({ createdAt: -1 })
            .hint({ createdAt: -1 })
            .toArray();

        console.log(`💳 GET /payments returned ${payments.length} requests`);

        res.json(payments.map(payment => ({
            id: String(payment._id),
            username: payment.username,
            email: payment.email,
            amount: payment.amount,
            quantity: payment.quantity,
            paymentMethod: payment.paymentMethod,
            paymentTarget: payment.paymentTarget,
            proofImage: normalizePaymentProofPath(payment),
            status: payment.status,
            createdAt: payment.createdAt,
            rejectionReason: payment.rejectionReason || '',
            grantedCount: payment.grantedCount || 0
        })));
    } catch (err) {
        console.error('❌ Payments fetch error:', err);
        res.status(500).json({ message: 'فشل جلب طلبات الدفع' });
    }
});

app.post('/payments/:id/approve', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'معرف طلب الدفع غير صالح' });
        }

        const adminEmail = String(req.headers['x-admin-email'] || '').toLowerCase();
        const adminPassword = String(req.headers['x-admin-password'] || '');
        if (adminEmail !== ADMIN_EMAIL.toLowerCase() || adminPassword !== ADMIN_PASSWORD) {
            return res.status(403).json({ message: 'غير مصرح لك بإدارة طلبات الدفع' });
        }

        const ticketCount = Number(req.body?.ticketCount);
        if (!Number.isInteger(ticketCount) || ticketCount < 1) {
            return res.status(400).json({ message: 'عدد الأرقام غير صالح' });
        }

        const payment = await paymentsCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!payment) {
            return res.status(404).json({ message: 'طلب الدفع غير موجود' });
        }

        if (payment.status !== 'pending') {
            return res.status(400).json({ message: 'تمت معالجة هذا الطلب مسبقاً' });
        }

        const participant = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${payment.email}$`, 'i') }
        });
        if (!participant) {
            return res.status(404).json({ message: 'المستخدم المرتبط بالطلب غير موجود' });
        }

        const newTicketNumbers = await generateUniqueTicketNumbers(ticketCount);
        const currentNumbers = getParticipantNumbers(participant);
        const updatedNumbers = [...currentNumbers, ...newTicketNumbers];
        const approvalMessage = `مبروك، تم تأكيد طلبك وتم منحك عدد ${ticketCount} من الأرقام، وقد دخلت في السحب بنجاح`;

        await participantsCollection.updateOne(
            { _id: participant._id },
            {
                $set: {
                    ticketNumbers: updatedNumbers,
                    registrationNumber: updatedNumbers[0] || null
                },
                $push: {
                    messages: {
                        id: new ObjectId().toString(),
                        type: 'approved',
                        text: approvalMessage,
                        createdAt: new Date()
                    }
                }
            }
        );

        await paymentsCollection.updateOne(
            { _id: payment._id },
            {
                $set: {
                    status: 'approved',
                    grantedCount: ticketCount,
                    grantedNumbers: newTicketNumbers,
                    approvedAt: new Date()
                }
            }
        );

        res.json({
            message: 'تم قبول الطلب ومنح الأرقام بنجاح',
            ticketNumbers: newTicketNumbers
        });
    } catch (err) {
        console.error('❌ Payment approval error:', err);
        res.status(500).json({ message: 'فشل قبول طلب الدفع' });
    }
});

app.post('/payments/:id/reject', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'معرف طلب الدفع غير صالح' });
        }

        const adminEmail = String(req.headers['x-admin-email'] || '').toLowerCase();
        const adminPassword = String(req.headers['x-admin-password'] || '');
        if (adminEmail !== ADMIN_EMAIL.toLowerCase() || adminPassword !== ADMIN_PASSWORD) {
            return res.status(403).json({ message: 'غير مصرح لك بإدارة طلبات الدفع' });
        }

        const reason = String(req.body?.reason || '').trim();
        if (!reason) {
            return res.status(400).json({ message: 'سبب الرفض مطلوب' });
        }

        const payment = await paymentsCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!payment) {
            return res.status(404).json({ message: 'طلب الدفع غير موجود' });
        }

        if (payment.status !== 'pending') {
            return res.status(400).json({ message: 'تمت معالجة هذا الطلب مسبقاً' });
        }

        const participant = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${payment.email}$`, 'i') }
        });
        if (!participant) {
            return res.status(404).json({ message: 'المستخدم المرتبط بالطلب غير موجود' });
        }

        await paymentsCollection.updateOne(
            { _id: payment._id },
            {
                $set: {
                    status: 'rejected',
                    rejectionReason: reason,
                    rejectedAt: new Date()
                }
            }
        );

        await participantsCollection.updateOne(
            { _id: participant._id },
            {
                $push: {
                    messages: {
                        id: new ObjectId().toString(),
                        type: 'rejected',
                        text: `تم رفض طلبك. السبب: ${reason}`,
                        createdAt: new Date()
                    }
                }
            }
        );

        res.json({ message: 'تم رفض الطلب بنجاح' });
    } catch (err) {
        console.error('❌ Payment rejection error:', err);
        res.status(500).json({ message: 'فشل رفض طلب الدفع' });
    }
});

app.get('/user-profile', async (req, res) => {
    try {
        const email = String(req.query.email || '').trim();
        if (!email) {
            return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
        }

        const participant = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${email}$`, 'i') }
        });

        if (!participant) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        res.json(buildParticipantResponse(participant));
    } catch (err) {
        console.error('❌ User profile fetch error:', err);
        res.status(500).json({ message: 'فشل جلب بيانات المستخدم' });
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
            registrationNumber: getParticipantNumbers(user)[0] || null,
            ticketNumbers: getParticipantNumbers(user),
            prizeAddress: user.prizeAddress || '',
            messages: Array.isArray(user.messages) ? user.messages : [],
            role
        });
    } catch (err) {
        console.error('❌ Login error:', err);
        res.status(500).json({ message: 'حدث خطأ أثناء تسجيل الدخول' });
    }
});

// إنشاء مستخدم جديد بدون رقم مشاركة، ويتم منحه لاحقاً عبر مسار مخصص
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

        if (String(password).length < 8) {
            return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 8 أحرف أو أرقام على الأقل' });
        }

        const exists = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${email}$`, 'i') }
        });

        if (exists) {
            console.log('❌ Email already exists:', email);
            return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const role = (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user';

        const newParticipant = {
            username,
            family,
            email,
            passwordHash,
            prizeAddress: '',
            role,
            createdAt: new Date()
        };

        const result = await participantsCollection.insertOne(newParticipant);
        console.log('✅ User registered successfully:', {
            username,
            family,
            email,
            insertedId: result.insertedId
        });

        res.status(201).json({
            username,
            family,
            email,
            registrationNumber: null,
            ticketNumbers: [],
            prizeAddress: '',
            messages: [],
            role
        });
    } catch (err) {
        console.error('❌ Register error:', err);
        res.status(500).json({ message: 'حدث خطأ أثناء التسجيل' });
    }
});

// حفظ عنوان/معرّف استلام الجائزة للمستخدم
app.post('/participants/prize-address', async (req, res) => {
    try {
        console.log('🎁 Prize address update request:', {
            email: req.body.email,
            hasPrizeAddress: !!req.body.prizeAddress
        });

        const { email, prizeAddress } = req.body;
        if (!email || !prizeAddress) {
            return res.status(400).json({ message: 'البريد الإلكتروني وبيانات الاستلام مطلوبة' });
        }

        const updateResult = await participantsCollection.updateOne(
            { email: { $regex: new RegExp(`^${email}$`, 'i') } },
            { $set: { prizeAddress: String(prizeAddress).trim() } }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        const updatedUser = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${email}$`, 'i') }
        });

        res.json({
            message: 'تم حفظ بيانات الاستلام بنجاح',
            prizeAddress: updatedUser?.prizeAddress || ''
        });
    } catch (err) {
        console.error('❌ Prize address update error:', err);
        res.status(500).json({ message: 'فشل حفظ بيانات الاستلام' });
    }
});

// حفظ طلب دفع يدوي جديد
app.post('/submit-payment', function (req, res) {
    paymentUpload.single('proofImage')(req, res, async function (uploadErr) {
        if (uploadErr) {
            if (uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'حجم الصورة يجب ألا يتجاوز 2MB' });
            }
            if (uploadErr.message === 'INVALID_PAYMENT_IMAGE_TYPE') {
                return res.status(400).json({ message: 'يجب رفع صورة إثبات بصيغة صورة صحيحة' });
            }
            console.error('❌ Payment upload error:', uploadErr);
            return res.status(500).json({ message: 'فشل رفع صورة الإثبات' });
        }

        try {
            const {
                username,
                email,
                amount,
                quantity,
                paymentMethod,
                paymentTarget
            } = req.body || {};
            const proofImageFile = req.file || null;

            console.log('💳 POST /submit-payment received', {
                username: username || '',
                email: email || '',
                amount,
                quantity,
                paymentMethod: paymentMethod || '',
                paymentTarget: paymentTarget || '',
                uploadedFile: proofImageFile ? proofImageFile.filename : ''
            });

            if (!username || !email || !amount || !quantity || !paymentMethod || !paymentTarget || !proofImageFile) {
                removeUploadedPaymentProof(proofImageFile && proofImageFile.path);
                return res.status(400).json({ message: 'جميع بيانات الدفع مطلوبة' });
            }

            const relativeProofImagePath = `/uploads/payments/${proofImageFile.filename}`;
            const paymentRequest = {
                username: String(username).trim(),
                email: String(email).trim().toLowerCase(),
                amount: Number(amount),
                quantity: Number(quantity),
                paymentMethod: String(paymentMethod).trim(),
                paymentTarget: String(paymentTarget).trim(),
                proofImage: relativeProofImagePath,
                proofImageFilename: proofImageFile.filename,
                status: 'pending',
                createdAt: new Date()
            };

            if (
                !paymentRequest.username ||
                !paymentRequest.email ||
                !Number.isFinite(paymentRequest.amount) ||
                paymentRequest.amount < 1 ||
                !Number.isFinite(paymentRequest.quantity) ||
                paymentRequest.quantity < 1 ||
                !paymentRequest.paymentMethod ||
                !paymentRequest.paymentTarget ||
                !paymentRequest.proofImage
            ) {
                removeUploadedPaymentProof(proofImageFile.path);
                return res.status(400).json({ message: 'بيانات الدفع غير صالحة' });
            }

            const result = await paymentsCollection.insertOne(paymentRequest);
            console.log('💳 Payment saved successfully in MongoDB', {
                id: String(result.insertedId),
                email: paymentRequest.email,
                status: paymentRequest.status,
                proofImage: paymentRequest.proofImage
            });
            res.status(201).json({
                message: 'تم حفظ طلب الدفع',
                id: result.insertedId,
                status: paymentRequest.status
            });
        } catch (err) {
            removeUploadedPaymentProof(req.file && req.file.path);
            console.error('❌ Submit payment error:', err);
            res.status(500).json({ message: 'فشل حفظ طلب الدفع' });
        }
    });
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
