
// DIPA AI - DeepSeek secure backend (Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');

try {
  const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
const MODEL = (process.env.DEEPSEEK_MODEL || 'deepseek-flash').trim();
const API_URL = 'https://api.deepseek.com/chat/completions';
const PUBLIC_DIR = path.join(__dirname, 'public');

const SYSTEM_PROMPT = `You are DIPA, a female professional AI assistant inside the app "DIPA AI".
Personality: calm, clear, confident, intelligent and friendly.
Languages: Bengali, Hindi and English. Reply in the same language and script the user writes in.
If the user writes Bengali or Hindi in Latin letters, reply in that language using its native script.
If asked who you are, say exactly: "Hello! I am DIPA, your personal AI assistant." (translated naturally if needed).
Keep replies concise, usually 1-4 short sentences.
Avoid markdown, emojis and bullet symbols unless explicitly requested.
Be honest when you don't know something.`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const hits = new Map();

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 30;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) {
    if (!v.some(t => now - t < 60000)) hits.delete(k);
  }
}, 60000).unref();

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too_large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function toMessages(messages) {
  const out = [];

  for (const m of messages.slice(-20)) {
    if (!m || typeof m.text !== 'string' || !m.text.trim()) continue;

    const role =
      m.role === 'assistant' || m.role === 'model'
        ? 'assistant'
        : 'user';

    const content = m.text.slice(0, 4000);

    if (!out.length && role === 'assistant') continue;

    if (out.length && out[out.length - 1].role === role) {
      out[out.length - 1].content += '\n' + content;
    } else {
      out.push({ role, content });
    }
  }

  return out;
}

const LANG_NAMES = {
  bn: 'Bengali',
  hi: 'Hindi',
  en: 'English'
};

function langHint(lang) {
  return LANG_NAMES[lang]
    ? `\nThe user chose ${LANG_NAMES[lang]} as their preferred language. Reply in ${LANG_NAMES[lang]} unless they clearly write in another language.`
    : '';
}

async function generate(messages, lang) {
  let r, j;

  try {
    const allMessages = [
      {
        role: 'system',
        content: SYSTEM_PROMPT + langHint(lang)
      },
      ...messages
    ];

    r = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: allMessages,
        temperature: 0.7,
        max_tokens: 2048,
        thinking: { type: 'disabled' }
      }),
      signal: AbortSignal.timeout(30000)
    });

    j = await r.json().catch(() => ({}));

  } catch (e) {
    console.error('[deepseek] Network error:', e.message);
    return {
      status: 504,
      error: 'DIPA could not reach the AI service. Please try again.'
    };
  }

  if (!r.ok) {
    const message = (j.error && j.error.message) || '';
    console.error(`[deepseek] HTTP ${r.status}: ${message}`);

    if (r.status === 401 || r.status === 403) {
      return {
        status: 502,
        error: 'The DeepSeek API key was rejected. Please check the server settings.'
      };
    }

    if (r.status === 402) {
      return {
        status: 402,
        error: 'DeepSeek API balance may be insufficient. Please check the account.'
      };
    }

    if (r.status === 429) {
      return {
        status: 429,
        error: 'DeepSeek is busy or the request limit was reached. Please try again later.'
      };
    }

    return {
      status: 502,
      error: 'The DeepSeek service returned an error. Please try again.'
    };
  }

  const reply = j.choices?.[0]?.message?.content?.trim();

  if (reply) return { reply };

  return {
    status: 502,
    error: 'DIPA could not generate a reply. Please try again.'
  };
}

async function handleChat(req, res) {
  if (!API_KEY) {
    return send(res, 500, {
      error: 'The server is missing DEEPSEEK_API_KEY. Add it in Render Environment.'
    });
  }

  let data;

  try {
    data = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Invalid request.' });
  }

  const messages = toMessages(
    Array.isArray(data.messages) ? data.messages : []
  );

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return send(res, 400, { error: 'No user message.' });
  }

  const out = await generate(
    messages,
    typeof data.lang === 'string' ? data.lang : ''
  );

  if (out.reply) return send(res, 200, { reply: out.reply });

  return send(res, out.status || 502, { error: out.error });
}

async function handleHealth(url, res) {
  const info = {
    ok: true,
    configured: !!API_KEY,
    provider: 'DeepSeek',
    model: MODEL
  };

  if (url.searchParams.get('deep') === '1' && API_KEY) {
    const out = await generate([
      { role: 'user', content: 'Reply with the single word: OK' }
    ], '');

    info.deepseek = out.reply ? 'ok' : 'error';

    if (!out.reply) info.detail = out.error;
  }

  send(res, 200, info);
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (p === '/') p = '/index.html';

  const file = path.normalize(path.join(PUBLIC_DIR, p));

  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });

    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(self)');

  const url = new URL(req.url, 'http://x');
  const ip = (
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    ''
  ).toString().split(',').pop().trim();

  if (url.pathname === '/api/health') {
    if (url.searchParams.get('deep') === '1' && limited(ip)) {
      return send(res, 429, { error: 'Too many requests.' });
    }

    return handleHealth(url, res);
  }

  if (url.pathname === '/api/chat') {
    if (req.method !== 'POST') {
      return send(res, 405, { error: 'Method not allowed' });
    }

    if (limited(ip)) {
      return send(res, 429, {
        error: 'Too many requests. Please wait a moment.'
      });
    }

    return handleChat(req, res);
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    return res.end();
  }

  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `DIPA AI running. DeepSeek key ${API_KEY ? 'loaded' : 'MISSING'}`
  );
});
