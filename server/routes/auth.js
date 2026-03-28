const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REDIRECT_URI } = process.env;
const TOKEN_FILE = path.join(__dirname, '../.tokens.json');

function saveTokens(tokens) {
    if (process.env.NODE_ENV === 'production') return;
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function loadTokens() {
    if (process.env.NODE_ENV === 'production') return null;
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        }
    } catch (e) {
        console.warn('Could not load tokens file:', e.message);
    }
    return null;
}

function injectTokens(req) {
    if (!req.session.tokens) {
        const saved = loadTokens();
        if (saved) req.session.tokens = saved;
    }
}

router.get('/login', (req, res) => {
    const params = new URLSearchParams({
        client_id: YAHOO_CLIENT_ID,
        redirect_uri: YAHOO_REDIRECT_URI,
        response_type: 'code',
        language: 'en-us'
    });
    res.redirect(`https://api.login.yahoo.com/oauth2/request_auth?${params}`);
});

router.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No auth code received');

    try {
        const credentials = Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString('base64');
        const { data } = await axios.post(
            'https://api.login.yahoo.com/oauth2/get_token',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: YAHOO_REDIRECT_URI
            }),
            { headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const tokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + data.expires_in * 1000
        };

        req.session.tokens = tokens;
        saveTokens(tokens);

        const isProd = process.env.NODE_ENV === 'production';
        req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            res.redirect(isProd ? '/' : 'https://localhost:5173');
        });
    } catch (err) {
        console.error('OAuth error:', err.response?.data || err.message);
        res.status(500).send('Authentication failed');
    }
});

async function refreshTokens(current) {
    const credentials = Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString('base64');
    const { data } = await axios.post(
        'https://api.login.yahoo.com/oauth2/get_token',
        new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: current.refresh_token
        }),
        { headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || current.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000
    };
}

router.post('/refresh', async (req, res) => {
    injectTokens(req);
    if (!req.session.tokens?.refresh_token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const tokens = await refreshTokens(req.session.tokens);
        req.session.tokens = tokens;
        saveTokens(tokens);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

router.get('/status', (req, res) => {
    injectTokens(req);
    res.json({ authenticated: !!req.session.tokens?.access_token });
});

router.get('/logout', (req, res) => {
    try { fs.unlinkSync(TOKEN_FILE); } catch (e) { }
    req.session.destroy();
    const isProd = process.env.NODE_ENV === 'production';
    res.redirect(isProd ? '/' : 'https://localhost:5173');
});

module.exports = { router, injectTokens, refreshTokens, saveTokens, loadTokens };