const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// إعدادات الوصول والبيانات
app.use(cors());
app.use(express.json());

// الربط مع المسارات (Routes) الموجودة داخل مجلد routes
// تأكد أن هذه الملفات موجودة فعلياً داخل مجلد routes في GitHub
app.use('/api/auth', require('./routes/auth'));
app.use('/api/merchants', require('./routes/merchants'));
app.use('/api/passes', require('./routes/passes'));
app.use('/api/scan', require('./routes/scan'));
app.use('/api/admin', require('./routes/admin'));

// صفحة اختبار السيرفر (تظهر عند فتح الرابط في المتصفح)
app.get('/', (req, res) => {
    res.send('<h1>NuqaTi Backend is LIVE!</h1><p>Server is connected and running successfully.</p>');
});

// إعداد المنفذ الخاص بـ Railway
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is active on port ${PORT}`);
});
