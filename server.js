
‎// DIPA AI - secure backend (zero dependencies, Node 18+)
‎const http = require('http');
‎const fs = require('fs');
‎const path = require('path');
‎
‎// Minimal .env loader (keeps secrets out of the frontend and out of git)
‎try {
‎  const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
‎  for (const line of raw.split(/\r?\n/)) {
‎    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
‎    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
‎  }
‎} catch { /* no .env file; rely on real environment variables / host secrets */ }
‎
‎const PORT = process.env.PORT || 3000;
‎const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
‎const MODEL = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
‎const GEMINI_BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
‎// If the primary model is unavailable / rate-limited, try these in order.
‎const MODELS = [...new Set([MODEL, 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-flash-latest'])];
‎const PUBLIC_DIR = path.join(__dirname, 'public');
‎
‎const SYSTEM_PROMPT = `You are DIPA, a female professional AI assistant inside the app "DIPA AI".
‎Personality: calm, clear, confident, intelligent, friendly but never childish. Speak like a polished professional assistant.
‎Languages: Bengali, Hindi and English. ALWAYS reply in the same language and script the user wrote in
‎(Bengali script -> Bengali, Devanagari -> Hindi, otherwise English). If the user writes Bengali or Hindi in Latin letters, reply in that language using its native script.
‎If asked who you are, say exactly: "Hello! I am DIPA, your personal AI assistant." (translated naturally if the user is not using English).
‎Your replies are read aloud, so keep them concise (usually 1-4 short sentences), natural, and do NOT use markdown, asterisks, bullet symbols, emojis or code fences unless the user explicitly asks for code.
‎Use feminine self-reference where the language requires gender. Be honest when you don't know something.`;
‎
‎const MIME = {
‎  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
‎  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
‎  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
‎  '.webmanifest': 'application/manifest+json'
‎};
‎
‎// Simple in-memory rate limit: 30 requests / minute / IP
‎const hits = new Map();
‎function limited(ip) {
‎  const now = Date.now();
‎  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
‎  arr.push(now);
‎  hits.set(ip, arr);
‎  return arr.length > 30;
‎}
‎setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 60000)) hits.delete(k); }, 60000).unref();
‎
‎function send(res, code, obj) {
‎  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
‎  res.end(JSON.stringify(obj));
‎}
‎
‎function readBody(req, limit = 64 * 1024) {
‎  return new Promise((resolve, reject) => {
‎    let size = 0; const chunks = [];
‎    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
‎    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
‎    req.on('error', reject);
‎  });
‎}
‎
‎// Gemini needs alternating roles starting with "user"
‎function toContents(messages) {
‎  const out = [];
‎  for (const m of messages.slice(-20)) {
‎    if (!m || typeof m.text !== 'string' || !m.text.trim()) continue;
‎    const role = m.role === 'assistant' || m.role === 'model' ? 'model' : 'user';
‎    const text = m.text.slice(0, 4000);
‎    if (!out.length && role === 'model') continue;
‎    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += '\n' + text;
‎    else out.push({ role, parts: [{ text }] });
‎  }
‎  return out;
‎}
‎
‎const LANG_NAMES = { bn: 'Bengali', hi: 'Hindi', en: 'English' };
‎function langHint(l) {
‎  return LANG_NAMES[l] ? `\nThe user chose ${LANG_NAMES[l]} as their preferred language: reply in ${LANG_NAMES[l]} unless they clearly write in another one.` : '';
‎}
‎
‎// Calls Gemini, falling back to other models on 404/429/5xx. Returns {reply} or {error, status}.
‎async function generate(contents, lang) {
‎  let last = { status: 502, message: '' };
‎  for (const model of MODELS) {
‎    const generationConfig = { temperature: 0.7, maxOutputTokens: 2048 };
‎    // 2.5 Flash "thinking" adds seconds of delay; voice chat is better without it.
‎    if (/2\.5-flash/.test(model) && !/lite/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
‎    let r, j;
‎    try {
‎      r = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
‎        method: 'POST',
‎        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
‎        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT + langHint(lang) }] }, contents, generationConfig }),
‎        signal: AbortSignal.timeout(25000)
‎      });
‎      j = await r.json().catch(() => ({}));
‎    } catch (e) {
‎      console.error(`[gemini] ${model} network error:`, e.cause ? `${e.message} (${e.cause.code || e.cause.message})` : e.message);
‎      return { status: 504, error: 'DIPA could not reach the Gemini service. Please check the connection and try again.' };
‎    }
‎    if (r.ok) {
‎      const cand = j.candidates && j.candidates[0];
‎      const parts = (cand && cand.content && cand.content.parts) || [];
‎      const reply = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
‎      if (reply) return { reply, model };
‎      const why = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || 'EMPTY';
‎      console.error(`[gemini] ${model} returned no text (${why})`);
‎      return { status: 422, error: 'I could not answer that one. Could you rephrase or ask something else?' };
‎    }
‎    const message = (j.error && j.error.message) || '';
‎    console.error(`[gemini] ${model} HTTP ${r.status}: ${message}`);
‎    last = { status: r.status, message };
‎    if (r.status === 401 || r.status === 403 || /api key/i.test(message))
‎      return { status: 502, error: 'The Gemini API key on the server was rejected. The owner should check GEMINI_API_KEY in Secrets.' };
‎    // 400 (bad request for this model), 404, 429, 5xx -> try next model
‎  }
‎  if (last.status === 429) return { status: 429, error: 'Gemini is busy or the free quota is used up. Please try again in a minute.' };
‎  return { status: 502, error: 'The Gemini service returned an error. Please try again.' };
‎}
‎
‎async function handleChat(req, res) {
‎  if (!API_KEY) return send(res, 500, { error: 'The server is missing GEMINI_API_KEY. Add it in Secrets (or .env) and restart.' });
‎  let data;
‎  try { data = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Invalid request.' }); }
‎  const contents = toContents(Array.isArray(data.messages) ? data.messages : []);
‎  if (!contents.length || contents[contents.length - 1].role !== 'user') return send(res, 400, { error: 'No user message.' });
‎  const out = await generate(contents, typeof data.lang === 'string' ? data.lang : '');
‎  if (out.reply) return send(res, 200, { reply: out.reply });
‎  send(res, out.status || 502, { error: out.error });
‎}
‎
‎async function handleHealth(url, res) {
‎  const info = { ok: true, configured: !!API_KEY, model: MODEL };
‎  if (url.searchParams.get('deep') === '1' && API_KEY) {
‎    // Optional live check: /api/health?deep=1 makes one tiny Gemini call
‎    const out = await generate([{ role: 'user', parts: [{ text: 'Reply with the single word: OK' }] }]);
‎    info.gemini = out.reply ? 'ok' : 'error';
‎    if (out.reply) info.usedModel = out.model; else info.detail = out.error;
‎  }
‎  send(res, 200, info);
‎}
‎
‎function serveStatic(req, res) {
‎  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
‎  if (p === '/') p = '/index.html';
‎  const file = path.normalize(path.join(PUBLIC_DIR, p));
‎  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
‎  fs.readFile(file, (err, buf) => {
‎    if (err) { res.writeHead(404); return res.end('Not found'); }
‎    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
‎    res.end(buf);
‎  });
‎}
‎
‎const server = http.createServer(async (req, res) => {
‎  res.setHeader('X-Content-Type-Options', 'nosniff');
‎  res.setHeader('X-Frame-Options', 'DENY');
‎  res.setHeader('Referrer-Policy', 'no-referrer');
‎  res.setHeader('Permissions-Policy', 'microphone=(self)');
‎  const url = new URL(req.url, 'http://x');
‎  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',').pop().trim();
‎
‎  if (url.pathname === '/api/health') {
‎    if (url.searchParams.get('deep') === '1' && limited(ip)) return send(res, 429, { error: 'Too many requests.' });
‎    return handleHealth(url, res);
‎  }
‎  if (url.pathname === '/api/chat') {
‎    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
‎    if (limited(ip)) return send(res, 429, { error: 'Too many requests. Please wait a moment.' });
‎    return handleChat(req, res);
‎  }
‎  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
‎  serveStatic(req, res);
‎});
‎
‎server.listen(PORT, '0.0.0.0', () => {
‎  console.log(`DIPA AI running on http://localhost:${PORT}  (Gemini key ${API_KEY ? 'loaded' : 'MISSING'})`);
‎});
