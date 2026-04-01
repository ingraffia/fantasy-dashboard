const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const router = express.Router();

const {
    YAHOO_CLIENT_ID,
    YAHOO_CLIENT_SECRET,
    YAHOO_REDIRECT_URI,
    SESSION_SECRET
} = process.env;

const AUTH_HEADER_NAME = 'x-auth-token';
const AUTH_TOKEN_TTL = '30d';

function getJwtSecret() {
    if (!SESSION_SECRET) {
        throw new Error('SESSION_SECRET is required for auth token signing');
    }
    return SESSION_SECRET;
}

function signAuthToken(yahooTokens) {
    return jwt.sign(
        {
            yahoo: yahooTokens
        },
        getJwtSecret(),
        { expiresIn: AUTH_TOKEN_TTL }
    );
}

function getTokens(authToken) {
    if (!authToken) return null;
    try {
        const payload = jwt.verify(authToken, getJwtSecret());
        return payload?.yahoo || null;
    } catch (err) {
        return null;
    }
}

function extractBearerToken(req) {
    const authHeader = req.headers.authorization;
    return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

function attachAuthToken(res, authToken) {
    res.setHeader(AUTH_HEADER_NAME, authToken);
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

        let data;
        let lastErr;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const resp = await axios.post(
                    'https://api.login.yahoo.com/oauth2/get_token',
                    new URLSearchParams({
                        grant_type: 'authorization_code',
                        code,
                        redirect_uri: YAHOO_REDIRECT_URI
                    }),
                    {
                        headers: {
                            Authorization: `Basic ${credentials}`,
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        timeout: 10000
                    }
                );
                data = resp.data;
                break;
            } catch (e) {
                lastErr = e;
                console.error(`OAuth attempt ${attempt} failed:`, e.message || e.code);
                if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            }
        }
        if (!data) throw lastErr;

        const yahooTokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + data.expires_in * 1000
        };

        const authToken = signAuthToken(yahooTokens);

        const isProd = process.env.NODE_ENV === 'production';
        const base = isProd ? '' : 'https://localhost:5173';
        res.redirect(`${base}/?auth=${encodeURIComponent(authToken)}`);
    } catch (err) {
        console.error('OAuth error:', JSON.stringify(err.response?.data) || err.message);
        console.error('OAuth status:', err.response?.status);
        console.error('OAuth message:', err.message);
        console.error('OAuth code:', err.code);
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
        {
            headers: {
                Authorization: `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000
        }
    );
    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || current.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000
    };
}

router.get('/status', async (req, res) => {
    const authToken = extractBearerToken(req);
    const tokens = getTokens(authToken);

    if (!tokens?.refresh_token) {
        return res.json({ authenticated: false });
    }

    if (Date.now() <= tokens.expires_at - 5 * 60 * 1000) {
        return res.json({ authenticated: true });
    }

    try {
        const refreshedTokens = await refreshYahooTokens(tokens);
        attachAuthToken(res, signAuthToken(refreshedTokens));
        return res.json({ authenticated: true });
    } catch (err) {
        console.error('Status refresh failed:', err.response?.data || err.message);
        return res.json({ authenticated: false });
    }
});

router.get('/logout', (req, res) => {
    res.json({ ok: true });
});

module.exports = {
    router,
    AUTH_HEADER_NAME,
    attachAuthToken,
    extractBearerToken,
    getTokens,
    refreshYahooTokens,
    signAuthToken
};
