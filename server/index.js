require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { router: authRoutes } = require('./routes/auth');
const fantasyRoutes = require('./routes/fantasy');

const app = express();
app.set('trust proxy', 1)
const isProd = process.env.NODE_ENV === 'production';

app.use(cors({
    origin: isProd ? false : 'https://localhost:5173',
    credentials: true
}));
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/api', fantasyRoutes);
app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (isProd) {
    app.use(express.static(path.join(__dirname, '../client/dist')))
    app.get('/{*path}', (req, res) => {
        res.sendFile(path.join(__dirname, '../client/dist/index.html'))
    })
}

const PORT = process.env.PORT || 3001;

if (isProd) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
} else {
    const https = require('https');
    const fs = require('fs');
    const sslOptions = {
        key: fs.readFileSync('./localhost-key.pem'),
        cert: fs.readFileSync('./localhost.pem'),
    };
    https.createServer(sslOptions, app).listen(PORT, () => {
        console.log(`Server running on https://localhost:${PORT}`);
    });
}
