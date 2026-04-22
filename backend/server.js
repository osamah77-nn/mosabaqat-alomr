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

function resolvePaymentProofFilePath(payment) {
    if (payment && typeof payment.proofImage === 'string' && payment.proofImage.startsWith('/uploads/payments/')) {
        const filename = path.basename(payment.proofImage);
        return path.join(paymentUploadsDir, filename);
    }
    if (payment && payment.proofImageFilename) {
        return path.join(paymentUploadsDir, payment.proofImageFilename);
    }
    return '';
}

async function ensurePaymentsIndexes() {
    await paymentsCollection.createIndex({ createdAt: -1 }, { name: 'payments_createdAt_desc' });
    await paymentsCollection.createIndex({ status: 1, createdAt: -1 }, { name: 'payments_status_createdAt_desc' });
}

async function ensureReferralWithdrawIndexes() {
    await referralWithdrawRequestsCollection.createIndex({ createdAt: -1 }, { name: 'referral_withdraw_createdAt_desc' });
    await referralWithdrawRequestsCollection.createIndex({ email: 1, status: 1 }, { name: 'referral_withdraw_email_status' });
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

async function cleanupExpiredPaymentProofs() {
    const cutoffDate = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const expiredPayments = await paymentsCollection.find(
        {
            proofImageDeletedAt: { $exists: false },
            $or: [
                {
                    status: 'approved',
                    approvedAt: { $lte: cutoffDate }
                },
                {
                    status: 'rejected',
                    rejectedAt: { $lte: cutoffDate }
                }
            ]
        },
        {
            projection: {
                proofImage: 1,
                proofImageFilename: 1
            }
        }
    ).toArray();

    if (!expiredPayments.length) {
        return;
    }

    let cleanedCount = 0;
    for (const payment of expiredPayments) {
        const filePath = resolvePaymentProofFilePath(payment);
        if (filePath) {
            try {
                await fs.promises.unlink(filePath);
            } catch (err) {
                if (err && err.code !== 'ENOENT') {
                    console.error('❌ Failed to delete expired payment proof file:', payment._id, err.message);
                    continue;
                }
            }
        }

        await paymentsCollection.updateOne(
            { _id: payment._id },
            {
                $set: {
                    proofImage: null,
                    proofImageFilename: null,
                    proofImageDeletedAt: new Date()
                }
            }
        );
        cleanedCount += 1;
    }

    if (cleanedCount) {
        console.log(`💳 Expired payment proof images deleted: ${cleanedCount}`);
    }
}

// ربط MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'mosabaqat_alomr';
let db, newsCollection, participantsCollection, winnerCollection, paymentsCollection, referralWithdrawRequestsCollection;

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
        referralWithdrawRequestsCollection = db.collection('referralWithdrawRequests');
        await ensureParticipantsIndexes();
        await backfillParticipantReferralFields();
        await ensurePaymentsIndexes();
        await ensureReferralWithdrawIndexes();
        await migrateLegacyPaymentProofs();
        await cleanupExpiredPaymentProofs();

        console.log('✅ Connected to MongoDB successfully');
        console.log('✅ Database:', DB_NAME);
        console.log('✅ Collections initialized:', {
            news: !!newsCollection,
            participants: !!participantsCollection,
            winner: !!winnerCollection,
            payments: !!paymentsCollection,
            referralWithdrawRequests: !!referralWithdrawRequestsCollection
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

async function generateUniqueReferralCode() {
    while (true) {
        const candidate = `REF${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const exists = await participantsCollection.findOne(
            { referralCode: candidate },
            { projection: { _id: 1 } }
        );
        if (!exists) {
            return candidate;
        }
    }
}

async function ensureParticipantsIndexes() {
    await participantsCollection.createIndex({ referralCode: 1 }, { unique: true, sparse: true, name: 'participants_referralCode_unique' });
}

async function backfillParticipantReferralFields() {
    const participantsWithoutCodes = await participantsCollection.find(
        {
            $or: [
                { referralCode: { $exists: false } },
                { referralCode: null },
                { referralCode: '' }
            ]
        },
        {
            projection: { _id: 1 }
        }
    ).toArray();

    for (const participant of participantsWithoutCodes) {
        const referralCode = await generateUniqueReferralCode();
        await participantsCollection.updateOne(
            { _id: participant._id },
            { $set: { referralCode } }
        );
    }
    if (participantsWithoutCodes.length) {
        console.log(`✅ Referral codes backfilled for ${participantsWithoutCodes.length} users`);
    }

    const referralFieldSync = await participantsCollection.updateMany(
        {
            $or: [
                { referralBalance: { $exists: false } },
                { referredBy: { $exists: false } },
                { referredBy: null }
            ]
        },
        [
            {
                $set: {
                    referralBalance: { $ifNull: ['$referralBalance', 0] },
                    referredBy: {
                        $cond: [
                            {
                                $or: [
                                    { $eq: ['$referredBy', null] },
                                    { $eq: ['$referredBy', ''] }
                                ]
                            },
                            { $ifNull: ['$referredByCode', ''] },
                            '$referredBy'
                        ]
                    }
                }
            }
        ]
    );

    if (referralFieldSync.modifiedCount) {
        console.log(`✅ Referral metadata backfilled for ${referralFieldSync.modifiedCount} users`);
    }
    const tutorialFieldSync = await participantsCollection.updateMany(
        { tutorialSeen: { $exists: false } },
        { $set: { tutorialSeen: false } }
    );

    if (tutorialFieldSync.modifiedCount) {
        console.log(`Tutorial flags backfilled for ${tutorialFieldSync.modifiedCount} users`);
    }
}

function buildParticipantResponse(participant) {
    const ticketNumbers = getParticipantNumbers(participant);
    return {
        id: participant._id,
        username: participant.username,
        family: participant.family || '',
        email: participant.email,
        referralCode: participant.referralCode || '',
        referredBy: participant.referredBy || participant.referredByCode || '',
        referredByCode: participant.referredByCode || '',
        referredByUserId: participant.referredByUserId ? String(participant.referredByUserId) : '',
        referralBalance: Number(participant.referralBalance || 0),
        registrationNumber: ticketNumbers[0] || null,
        ticketNumbers,
        prizeAddress: participant.prizeAddress || '',
        tutorialSeen: Boolean(participant.tutorialSeen),
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
                        proofImageDeletedAt: 1,
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
            proofImageDeletedAt: payment.proofImageDeletedAt || null,
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
        const referredByCode = String(participant.referredBy || participant.referredByCode || '').trim().toUpperCase();
        const paymentAmount = Number(payment.amount || 0);
        const referralCommission = referredByCode ? Number((paymentAmount * 0.10).toFixed(2)) : 0;
        let referralPaid = false;
        let referralBeneficiaryUserId = null;

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

        if (referredByCode && !payment.referralPaid && referralCommission > 0) {
            const inviter = await participantsCollection.findOne({
                referralCode: referredByCode,
                _id: { $ne: participant._id }
            });

            if (inviter) {
                await participantsCollection.updateOne(
                    { _id: inviter._id },
                    {
                        $inc: {
                            referralBalance: referralCommission
                        }
                    }
                );
                referralPaid = true;
                referralBeneficiaryUserId = inviter._id;
            }
        }

        await paymentsCollection.updateOne(
            { _id: payment._id },
            {
                $set: {
                    status: 'approved',
                    grantedCount: ticketCount,
                    grantedNumbers: newTicketNumbers,
                    approvedAt: new Date(),
                    referralPaid,
                    referralCommission,
                    referralBeneficiaryUserId,
                    referralSourceCode: referredByCode || ''
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
app.post('/participants/tutorial-seen', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ message: 'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ Ù…Ø·Ù„ÙˆØ¨' });
        }

        const participant = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${email}$`, 'i') }
        });

        if (!participant) {
            return res.status(404).json({ message: 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });
        }

        await participantsCollection.updateOne(
            { _id: participant._id },
            { $set: { tutorialSeen: true } }
        );

        res.json({
            message: 'ØªÙ… Ø­ÙØ¸ Ø­Ø§Ù„Ø© Ø§Ù„ØªØ¹Ù„ÙŠÙ…Ø§Øª',
            tutorialSeen: true
        });
    } catch (err) {
        console.error('Tutorial seen update error:', err);
        res.status(500).json({ message: 'ÙØ´Ù„ Ø­ÙØ¸ Ø­Ø§Ù„Ø© Ø§Ù„ØªØ¹Ù„ÙŠÙ…Ø§Øª' });
    }
});

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
            referralCode: user.referralCode || '',
            referredBy: user.referredBy || user.referredByCode || '',
            referredByCode: user.referredByCode || '',
            referredByUserId: user.referredByUserId ? String(user.referredByUserId) : '',
            referralBalance: Number(user.referralBalance || 0),
            registrationNumber: getParticipantNumbers(user)[0] || null,
            ticketNumbers: getParticipantNumbers(user),
            prizeAddress: user.prizeAddress || '',
            tutorialSeen: Boolean(user.tutorialSeen),
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

        const duplicateName = await participantsCollection.findOne({
            username: { $regex: new RegExp(`^${String(username).trim()}$`, 'i') },
            family: { $regex: new RegExp(`^${String(family).trim()}$`, 'i') }
        });

        if (duplicateName) {
            return res.status(400).json({ message: 'الاسم الكامل مستخدم بالفعل' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const role = (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user';
        const referralCode = await generateUniqueReferralCode();

        const newParticipant = {
            username,
            family,
            email,
            passwordHash,
            referralCode,
            referredBy: '',
            referredByCode: '',
            referredByUserId: null,
            referralBalance: 0,
            prizeAddress: '',
            tutorialSeen: false,
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
            referralCode,
            referredBy: '',
            referredByCode: '',
            referredByUserId: '',
            referralBalance: 0,
            registrationNumber: null,
            ticketNumbers: [],
            prizeAddress: '',
            tutorialSeen: false,
            messages: [],
            role
        });
    } catch (err) {
        console.error('❌ Register error:', err);
        res.status(500).json({ message: 'حدث خطأ أثناء التسجيل' });
    }
});

app.post('/participants/referral', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const referralCode = String(req.body?.referralCode || '').trim().toUpperCase();

        if (!email || !referralCode) {
            return res.status(400).json({ message: 'البريد الإلكتروني ورمز الإحالة مطلوبان' });
        }

        const participant = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${email}$`, 'i') }
        });

        if (!participant) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        if (participant.referredBy || participant.referredByCode) {
            return res.status(400).json({ message: 'تم حفظ رمز الإحالة مسبقاً ولا يمكن تغييره' });
        }

        if (String(participant.referralCode || '').toUpperCase() === referralCode) {
            return res.status(400).json({ message: 'لا يمكنك إدخال رمز الإحالة الخاص بك' });
        }

        const inviter = await participantsCollection.findOne({
            referralCode
        });

        if (!inviter) {
            return res.status(400).json({ message: 'رمز الإحالة غير صحيح' });
        }

        await participantsCollection.updateOne(
            { _id: participant._id },
            {
                $set: {
                    referredBy: referralCode,
                    referredByCode: referralCode,
                    referredByUserId: inviter._id
                }
            }
        );

        res.json({
            message: 'تم حفظ رمز الإحالة بنجاح',
            referredBy: referralCode,
            referredByCode: referralCode,
            referredByUserId: String(inviter._id)
        });
    } catch (err) {
        console.error('❌ Referral save error:', err);
        res.status(500).json({ message: 'فشل حفظ رمز الإحالة' });
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

app.post('/referral-withdraw-requests', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
        }

        const participant = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${email}$`, 'i') }
        });

        if (!participant) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        const referralBalance = Number(participant.referralBalance || 0);
        if (!(referralBalance > 0)) {
            return res.status(400).json({ message: 'لا يمكن إرسال طلب سحب لأن رصيد أرباح الإحالة يساوي صفر' });
        }

        const prizeAddress = String(participant.prizeAddress || '').trim();
        if (!prizeAddress) {
            return res.status(400).json({ message: 'يجب عليك أولاً إدخال عنوان الاستلام قبل إرسال طلب السحب' });
        }

        const existingPendingRequest = await referralWithdrawRequestsCollection.findOne({
            email: participant.email.toLowerCase(),
            status: 'pending'
        });

        if (existingPendingRequest) {
            return res.status(400).json({ message: 'لديك طلب سحب أرباح إحالة قيد المراجعة بالفعل' });
        }

        const withdrawRequest = {
            username: participant.username,
            family: participant.family || '',
            email: participant.email.toLowerCase(),
            referralCode: participant.referralCode || '',
            referralBalance,
            requestedAmount: referralBalance,
            prizeAddress,
            status: 'pending',
            createdAt: new Date(),
            participantId: participant._id
        };

        const result = await referralWithdrawRequestsCollection.insertOne(withdrawRequest);
        res.status(201).json({
            message: 'تم إرسال طلب السحب بنجاح وهو الآن قيد المراجعة',
            id: String(result.insertedId),
            status: withdrawRequest.status,
            requestedAmount: withdrawRequest.requestedAmount
        });
    } catch (err) {
        console.error('❌ Referral withdraw request error:', err);
        res.status(500).json({ message: 'فشل إرسال طلب سحب أرباح الإحالة' });
    }
});

app.get('/referral-withdraw-requests', async (req, res) => {
    try {
        const adminEmail = String(req.headers['x-admin-email'] || '').toLowerCase();
        const adminPassword = String(req.headers['x-admin-password'] || '');
        if (adminEmail !== ADMIN_EMAIL.toLowerCase() || adminPassword !== ADMIN_PASSWORD) {
            return res.status(403).json({ message: 'غير مصرح لك بالوصول إلى طلبات سحب أرباح الإحالة' });
        }

        const requests = await referralWithdrawRequestsCollection.find(
            {},
            {
                projection: {
                    username: 1,
                    family: 1,
                    email: 1,
                    referralCode: 1,
                    referralBalance: 1,
                    requestedAmount: 1,
                    prizeAddress: 1,
                    status: 1,
                    createdAt: 1,
                    rejectionReason: 1
                }
            }
        ).sort({ createdAt: -1 }).toArray();

        res.json(requests.map(request => ({
            id: String(request._id),
            username: request.username || '',
            family: request.family || '',
            email: request.email || '',
            referralCode: request.referralCode || '',
            referralBalance: Number(request.referralBalance || 0),
            requestedAmount: Number(request.requestedAmount || 0),
            prizeAddress: request.prizeAddress || '',
            status: request.status || 'pending',
            createdAt: request.createdAt,
            rejectionReason: request.rejectionReason || ''
        })));
    } catch (err) {
        console.error('❌ Referral withdraw requests fetch error:', err);
        res.status(500).json({ message: 'فشل جلب طلبات سحب أرباح الإحالة' });
    }
});

app.post('/referral-withdraw-requests/:id/approve', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'معرف طلب السحب غير صالح' });
        }

        const adminEmail = String(req.headers['x-admin-email'] || '').toLowerCase();
        const adminPassword = String(req.headers['x-admin-password'] || '');
        if (adminEmail !== ADMIN_EMAIL.toLowerCase() || adminPassword !== ADMIN_PASSWORD) {
            return res.status(403).json({ message: 'غير مصرح لك بإدارة طلبات سحب أرباح الإحالة' });
        }

        const request = await referralWithdrawRequestsCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!request) {
            return res.status(404).json({ message: 'طلب سحب أرباح الإحالة غير موجود' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ message: 'تمت معالجة هذا الطلب مسبقاً' });
        }

        const participant = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${request.email}$`, 'i') }
        });

        if (!participant) {
            return res.status(404).json({ message: 'المستخدم المرتبط بالطلب غير موجود' });
        }

        const requestedAmount = Number(request.requestedAmount || 0);
        if (!(requestedAmount > 0)) {
            return res.status(400).json({ message: 'المبلغ المطلوب غير صالح' });
        }

        const participantUpdate = await participantsCollection.updateOne(
            {
                _id: participant._id,
                referralBalance: { $gte: requestedAmount }
            },
            {
                $inc: { referralBalance: -requestedAmount },
                $push: {
                    messages: {
                        id: new ObjectId().toString(),
                        type: 'referral-withdraw-approved',
                        text: 'تمت الموافقة على طلب سحب أرباح الإحالة الخاص بك وسيتم تحويل المبلغ إليك',
                        createdAt: new Date()
                    }
                }
            }
        );

        if (participantUpdate.modifiedCount === 0) {
            return res.status(400).json({ message: 'رصيد أرباح الإحالة الحالي أقل من المبلغ المطلوب' });
        }

        await referralWithdrawRequestsCollection.updateOne(
            { _id: request._id },
            {
                $set: {
                    status: 'approved',
                    approvedAt: new Date()
                }
            }
        );

        res.json({ message: 'تمت الموافقة على طلب سحب أرباح الإحالة بنجاح' });
    } catch (err) {
        console.error('❌ Referral withdraw approve error:', err);
        res.status(500).json({ message: 'فشل قبول طلب سحب أرباح الإحالة' });
    }
});

app.post('/referral-withdraw-requests/:id/reject', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'معرف طلب السحب غير صالح' });
        }

        const adminEmail = String(req.headers['x-admin-email'] || '').toLowerCase();
        const adminPassword = String(req.headers['x-admin-password'] || '');
        if (adminEmail !== ADMIN_EMAIL.toLowerCase() || adminPassword !== ADMIN_PASSWORD) {
            return res.status(403).json({ message: 'غير مصرح لك بإدارة طلبات سحب أرباح الإحالة' });
        }

        const reason = String(req.body?.reason || '').trim();
        if (!reason) {
            return res.status(400).json({ message: 'سبب الرفض مطلوب' });
        }

        const request = await referralWithdrawRequestsCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!request) {
            return res.status(404).json({ message: 'طلب سحب أرباح الإحالة غير موجود' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ message: 'تمت معالجة هذا الطلب مسبقاً' });
        }

        const participant = await participantsCollection.findOne({
            email: { $regex: new RegExp(`^${request.email}$`, 'i') }
        });

        if (!participant) {
            return res.status(404).json({ message: 'المستخدم المرتبط بالطلب غير موجود' });
        }

        await referralWithdrawRequestsCollection.updateOne(
            { _id: request._id },
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
                        type: 'referral-withdraw-rejected',
                        text: `تم رفض طلب سحب أرباح الإحالة. السبب: ${reason}`,
                        createdAt: new Date()
                    }
                }
            }
        );

        res.json({ message: 'تم رفض طلب سحب أرباح الإحالة بنجاح' });
    } catch (err) {
        console.error('❌ Referral withdraw reject error:', err);
        res.status(500).json({ message: 'فشل رفض طلب سحب أرباح الإحالة' });
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

        setInterval(() => {
            cleanupExpiredPaymentProofs().catch(err => {
                console.error('❌ Scheduled payment proof cleanup error:', err);
            });
        }, 60 * 60 * 1000);
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
