const express = require('express');
const https = require('https');
const dns = require('dns');
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
const YAHOO_OAUTH_HOST = 'api.login.yahoo.com';

async function resolveIpv4Address(hostname) {
    const result = await dns.promises.lookup(hostname, { family: 4 });
    return result.address;
}

// Low-level HTTPS POST that bypasses axios connection pooling
async function httpsPost(url, body, headers, timeoutMs = 25000) {
    const parsed = new URL(url);
    const postData = typeof body === 'string' ? body : body.toString();
    const resolvedAddress = await resolveIpv4Address(parsed.hostname);

    return new Promise((resolve, reject) => {
        const options = {
            host: resolvedAddress,
            servername: parsed.hostname,
            family: 4,
            port: 443,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                Host: parsed.hostname,
                ...headers,
                'Content-Length': Buffer.byteLength(postData),
            },
            // Fresh agent per request — no keep-alive pool or TLS session reuse
            agent: new https.Agent({ keepAlive: false, maxCachedSessions: 0 }),
        };

        const req = https.request(options, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                let parsedBody;
                try { parsedBody = JSON.parse(raw); } catch { parsedBody = raw; }
                if (res.statusCode >= 400) {
                    const err = new Error(`HTTP ${res.statusCode}`);
                    err.status = res.statusCode;
                    err.data = parsedBody;
                    return reject(err);
                }
                resolve(parsedBody);
            });
        });

        req.on('socket', (socket) => {
            socket.once('connect', () => {
                console.log(`Yahoo OAuth socket connected to ${socket.remoteAddress || resolvedAddress}:${socket.remotePort || 443}`);
            });
            socket.once('secureConnect', () => {
                console.log(`Yahoo OAuth TLS established via ${socket.getProtocol?.() || 'unknown TLS version'}`);
            });
            socket.once('timeout', () => {
                console.error('Yahoo OAuth socket timeout before response completed');
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy();
            const err = new Error(`Request timed out after ${timeoutMs}ms`);
            err.code = 'ETIMEDOUT';
            err.phase = 'request';
            reject(err);
        });
        req.on('error', (err) => {
            if (!err.phase) err.phase = 'network';
            reject(err);
        });
        req.write(postData);
        req.end();
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseOAuthResponseData(responseData) {
    if (!responseData) return {};
    if (typeof responseData === 'object') return responseData;
    if (typeof responseData !== 'string') return {};
    try {
        return JSON.parse(responseData);
    } catch (_) {
        const params = new URLSearchParams(responseData);
        return {
            error: params.get('error') || '',
            error_description: params.get('error_description') || params.get('errorDescription') || responseData,
        };
    }
}

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

function classifyOAuthError(err) {
    const responseData = parseOAuthResponseData(err?.response?.data);
    const errorCode = responseData?.error || err?.code || '';
    const description = responseData?.error_description || responseData?.errorDescription || err?.message || '';
    const combined = `${errorCode} ${description}`.toLowerCase();
    const diagnostics = {
        status: err?.response?.status || 'none',
        code: err?.code || 'none',
        yahooError: responseData?.error || 'none',
        yahooDescription: description || 'none',
        redirectUri: YAHOO_REDIRECT_URI || 'missing',
    };

    if (combined.includes('redirect')) {
        return {
            title: 'Redirect URI mismatch',
            message: 'Yahoo rejected the callback URL. Check that the Yahoo app callback URL exactly matches YAHOO_REDIRECT_URI in Railway.',
            diagnostics,
        };
    }

    if (combined.includes('invalid_client') || combined.includes('client authentication')) {
        return {
            title: 'Yahoo client credentials rejected',
            message: 'Yahoo did not accept the client ID or client secret. Verify YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in Railway and in the Yahoo app settings.',
            diagnostics,
        };
    }

    if (combined.includes('invalid_grant') || combined.includes('authorization code')) {
        return {
            title: 'Yahoo authorization code rejected',
            message: 'Yahoo rejected the authorization code. This usually means the callback was reused, expired, or the redirect/app config does not match.',
            diagnostics,
        };
    }

    if (combined.includes('timeout') || combined.includes('econn') || combined.includes('network')) {
        return {
            title: 'Yahoo network request failed',
            message: 'The server could not complete the Yahoo token exchange. This points to a timeout or network/runtime issue rather than a browser problem.',
            diagnostics,
        };
    }

    return {
        title: 'Yahoo token exchange failed',
        message: description
            ? `Yahoo returned an OAuth error during token exchange: ${description}`
            : 'The server reached Yahoo but the OAuth token exchange did not complete successfully. Check the Railway logs for the OAuth error details.',
        diagnostics,
    };
}

function renderAuthErrorPage(details) {
    const title = details?.title || 'Authentication failed';
    const message = details?.message || 'The Yahoo login flow failed.';
    const diagnostics = details?.diagnostics || {};
    const diagnosticRows = [
        ['HTTP status', diagnostics.status],
        ['Node error code', diagnostics.code],
        ['Yahoo error', diagnostics.yahooError],
        ['Yahoo description', diagnostics.yahooDescription],
        ['Redirect URI', diagnostics.redirectUri],
    ].filter(([, value]) => value != null && value !== '');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #ffffff 0%, #f1f1f1 100%);
        color: #111111;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 24px;
      }
      .card {
        width: min(620px, 100%);
        background: rgba(255,255,255,0.94);
        border: 1px solid rgba(17,17,17,0.08);
        border-radius: 24px;
        box-shadow: 0 24px 70px rgba(10,10,10,0.12);
        padding: 32px 30px;
      }
      .eyebrow {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #52525b;
        margin-bottom: 10px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0;
        font-size: 15px;
        line-height: 1.65;
        color: #52525b;
      }
      .hint {
        margin-top: 18px;
        padding: 14px 16px;
        background: #f5f5f5;
        border-radius: 16px;
        color: #3f3f46;
        font-size: 14px;
      }
      .actions {
        margin-top: 22px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .diagnostics {
        margin-top: 18px;
        border-top: 1px solid rgba(17,17,17,0.08);
        padding-top: 16px;
        display: grid;
        gap: 8px;
      }
      .diag-row {
        display: grid;
        grid-template-columns: 160px minmax(0, 1fr);
        gap: 10px;
        font-size: 13px;
        line-height: 1.45;
      }
      .diag-label {
        color: #71717a;
        font-weight: 700;
      }
      .diag-value {
        color: #18181b;
        word-break: break-word;
      }
      a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 11px 16px;
        border-radius: 999px;
        text-decoration: none;
        font-weight: 700;
      }
      .primary {
        background: linear-gradient(135deg, #0a0a0a 0%, #2a2a2a 100%);
        color: white;
      }
      .secondary {
        background: #f5f5f5;
        color: #3f3f46;
        border: 1px solid rgba(17,17,17,0.08);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="eyebrow">Yahoo Authentication Error</div>
      <h1>${title}</h1>
      <p>${message}</p>
      <div class="hint">This is a server-side issue, not a browser setting problem. The next place to check is the Railway logs for the OAuth callback request.</div>
      <div class="diagnostics">
        ${diagnosticRows.map(([label, value]) => `<div class="diag-row"><div class="diag-label">${escapeHtml(label)}</div><div class="diag-value">${escapeHtml(value)}</div></div>`).join('')}
      </div>
      <div class="actions">
        <a class="primary" href="/auth/login">Try Yahoo Login Again</a>
        <a class="secondary" href="/">Back to App</a>
      </div>
    </div>
  </body>
</html>`;
}

router.get('/login', (req, res) => {
    if (!YAHOO_CLIENT_ID || !YAHOO_REDIRECT_URI) {
        return res.status(500).send(renderAuthErrorPage({
            title: 'Yahoo auth config is incomplete',
            message: 'The server is missing YAHOO_CLIENT_ID or YAHOO_REDIRECT_URI, so Yahoo login cannot start.',
        }));
    }
    const params = new URLSearchParams({
        client_id: YAHOO_CLIENT_ID,
        redirect_uri: YAHOO_REDIRECT_URI,
        response_type: 'code',
        language: 'en-us'
    });
    res.redirect(`https://api.login.yahoo.com/oauth2/request_auth?${params}`);
});

router.get('/callback', async (req, res) => {
    const { code, error, error_description: errorDescription } = req.query;
    if (error) {
        return res.status(400).send(renderAuthErrorPage({
            title: 'Yahoo login was not completed',
            message: errorDescription || `Yahoo returned an authorization error: ${error}`,
            diagnostics: {
                status: 'authorization',
                code: 'none',
                yahooError: error,
                yahooDescription: errorDescription || 'none',
                redirectUri: YAHOO_REDIRECT_URI || 'missing',
            },
        }));
    }
    if (!code) return res.status(400).send('No auth code received');
    if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET || !YAHOO_REDIRECT_URI) {
        return res.status(500).send(renderAuthErrorPage({
            title: 'Yahoo auth config is incomplete',
            message: 'The server is missing Yahoo OAuth environment variables required for the token exchange.',
            diagnostics: {
                status: 'config',
                code: 'none',
                yahooError: 'none',
                yahooDescription: 'missing env vars',
                redirectUri: YAHOO_REDIRECT_URI || 'missing',
            },
        }));
    }

    try {
        const credentials = Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString('base64');

        // DNS pre-flight: log whether we can resolve Yahoo's hostname
        dns.lookup(YAHOO_OAUTH_HOST, { family: 4 }, (dnsErr, address) => {
            if (dnsErr) console.error(`DNS lookup failed for ${YAHOO_OAUTH_HOST}:`, dnsErr.code);
            else console.log(`DNS resolved ${YAHOO_OAUTH_HOST} ->`, address);
        });

        let data;
        let lastErr;
        const RETRYABLE_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);
        for (let attempt = 1; attempt <= 4; attempt++) {
            try {
                console.log(`OAuth attempt ${attempt}: posting to Yahoo token endpoint`);
                data = await httpsPost(
                    `https://${YAHOO_OAUTH_HOST}/oauth2/get_token`,
                    new URLSearchParams({
                        grant_type: 'authorization_code',
                        code,
                        redirect_uri: YAHOO_REDIRECT_URI
                    }),
                    {
                        Authorization: `Basic ${credentials}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    25000
                );
                console.log('OAuth success on attempt', attempt);
                break;
            } catch (e) {
                lastErr = e;
                const status = e?.status || e?.response?.status;
                const isRetryable = !status || status >= 500 || status === 429 || RETRYABLE_CODES.has(e.code);
                console.error(`OAuth attempt ${attempt} failed:`, e.code || status || e.message, e.phase ? `(phase: ${e.phase})` : '');
                if (!isRetryable || attempt === 4) break;
                await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
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
        console.error('OAuth error:', JSON.stringify(parseOAuthResponseData(err.response?.data)) || err.message);
        console.error('OAuth status:', err.response?.status);
        console.error('OAuth message:', err.message);
        console.error('OAuth code:', err.code);
        console.error('OAuth phase:', err.phase);
        const details = classifyOAuthError(err);
        res.status(500).send(renderAuthErrorPage(details));
    }
});

async function refreshYahooTokens(current) {
    const credentials = Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString('base64');
    const data = await httpsPost(
        `https://${YAHOO_OAUTH_HOST}/oauth2/get_token`,
        new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: current.refresh_token
        }),
        {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        25000
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
