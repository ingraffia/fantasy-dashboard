const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

const { YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REDIRECT_URI } = process.env;
const TOKEN_STORE_FILE = path.join(__dirname, '../.token-store.json');

// Persistent token store: authToken -> yahooTokens
const tokenStore = new Map();

// Load persisted tokens on startup
try {
    const raw = fs.readFileSync(TOKEN_STORE_FILE, 'utf8');
    const saved = JSON.parse(raw);
    Object.entries(saved).forEach(([k, v]) => tokenStore.set(k, v));
    console.log(`Loaded ${tokenStore.size} token(s) from disk`);
} catch (e) { /* no saved tokens yet */ }

function persistTokenStore() {
    try {
        const obj = Object.fromEntries(tokenStore);
        fs.writeFileSync(TOKEN_STORE_FILE, JSON.stringify(obj));
    } catch (e) { console.error('Failed to persist token store:', e.message); }
}

function storeTokens(yahooTokens) {
    const authToken = crypto.randomBytes(32).toString('hex');
    tokenStore.set(authToken, yahooTokens);
    persistTokenStore();
    return authToken;
}

function getTokens(authToken) {
    return tokenStore.get(authToken) || null;
}

function updateTokens(authToken, yahooTokens) {
    tokenStore.set(authToken, yahooTokens);
    persistTokenStore();
}

function removeTokens(authToken) {
    tokenStore.delete(authToken);
    persistTokenStore();
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

        const yahooTokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + data.expires_in * 1000
        };

        const authToken = storeTokens(yahooTokens);

        const isProd = process.env.NODE_ENV === 'production';
        const base = isProd ? '' : 'https://localhost:5173';
        res.redirect(`${base}/?auth=${authToken}`);
    } catch (err) {
        console.error('OAuth error:', err.response?.data || err.message);
        res.status(500).send('Authentication failed');
    }
});

async function refreshYahooTokens(current) {
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

router.get('/status', (req, res) => {
    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!authToken) return res.json({ authenticated: false });
    const tokens = getTokens(authToken);
    res.json({ authenticated: !!tokens?.access_token });
});

router.get('/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (authToken) removeTokens(authToken);
    res.json({ ok: true });
});

module.exports = { router, getTokens, updateTokens, refreshYahooTokens, storeTokens };