/* DIPA AI - frontend. No API keys here; all AI calls go through /api/chat. */
(() => {
  const $ = s => document.querySelector(s);
  const log = $('#log'), input = $('#input'), form = $('#form'), micBtn = $('#mic'),
        stateText = $('#stateText'), statusDot = $('#statusDot'), muteBtn = $('#muteBtn');

  const INTRO = 'Hello! I am DIPA, your personal AI assistant.';
  const LANG = { en: 'en-IN', bn: 'bn-BD', hi: 'hi-IN' };
  let langChoice = 'auto';      // auto | en | bn | hi
  let voiceOn = true;
  let state = 'idle';           // idle | listening | thinking | speaking
  let history = [];             // {role:'user'|'assistant', text}
  let busy = false;
  let lastLang = 'en';          // language of the user's last message (used by Auto mic)

  /* ---------- helpers ---------- */
  function detectLang(text) {
    const bn = (text.match(/[ঀ-৿]/g) || []).length;
    const hi = (text.match(/[ऀ-ॿ]/g) || []).length;
    if (bn > 0 && bn >= hi) return 'bn';
    if (hi > 0) return 'hi';
    return 'en';
  }
  function setState(s) {
    state = s;
    stateText.textContent = { idle: 'STANDBY', listening: 'LISTENING', thinking: 'PROCESSING', speaking: 'SPEAKING' }[s];
  }
  function addMsg(role, text, cls = '') {
    const d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'me' : 'ai') + ' ' + cls;
    if (role !== 'user') { const w = document.createElement('span'); w.className = 'who'; w.textContent = 'DIPA'; d.appendChild(w); }
    d.appendChild(document.createTextNode(text));
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function typingBubble() {
    const d = document.createElement('div');
    d.className = 'msg ai';
    d.innerHTML = '<span class="who">DIPA</span><span class="typing"><span></span><span></span><span></span></span>';
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }

  /* ---------- text-to-speech (professional female voice) ---------- */
  const FEMALE = /female|woman|zira|heera|hazel|samantha|susan|aria|jenny|priya|neerja|swara|tanishaa|veena|karen|moira|sonia|natasha|google (hindi|bengali|uk english female|us english)|bangla|bengali|hindi/i;
  const MALE = /\bmale\b|david|mark|hemant|ravi|prabhat|madhur|pradeep|james|george|guy/i;
  const SAMPLE = {
    en: 'Hello! I am DIPA, your personal AI assistant.',
    bn: 'হ্যালো! আমি DIPA, আপনার ব্যক্তিগত এআই সহকারী।',
    hi: 'नमस्ते! मैं DIPA हूँ, आपकी निजी एआई सहायक।'
  };
  const LANG_NAME = { en: 'English', bn: 'Bengali', hi: 'Hindi' };
  let voices = [];
  function loadVoices() { voices = ('speechSynthesis' in window && speechSynthesis.getVoices()) || []; }
  if ('speechSynthesis' in window) {
    loadVoices(); speechSynthesis.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 500); setTimeout(loadVoices, 1500);   // Android loads voices late
  }
  const norm = l => (l || '').toLowerCase().replace('_', '-');
  const voicesFor = lang => voices.filter(v => norm(v.lang).startsWith(LANG[lang].slice(0, 2)));
  const savedVoice = lang => { try { return localStorage.getItem('dipa_voice_' + lang); } catch { return null; } };

  function pickVoice(lang) {
    const pool = voicesFor(lang);
    if (!pool.length) return null;
    const saved = savedVoice(lang), s = saved && pool.find(v => v.name === saved);
    if (s) return s;
    const code = norm(LANG[lang]);
    return pool.find(v => norm(v.lang) === code && FEMALE.test(v.name) && !MALE.test(v.name))
        || pool.find(v => FEMALE.test(v.name) && !MALE.test(v.name))
        || pool.find(v => !MALE.test(v.name))
        || pool[0];
  }
  function cleanForSpeech(t) {
    return t.replace(/```[\s\S]*?```/g, ' ').replace(/[*_#`>~|]/g, '').replace(/https?:\/\/\S+/g, ' link ')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
  }
  let speakId = 0;   // lets a newer speech cancel an older one cleanly
  function stopSpeaking() {
    speakId++;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (state === 'speaking') setState('idle');
  }
  function speak(text) {
    return new Promise(resolve => {
      if (!voiceOn || !('speechSynthesis' in window)) return resolve();
      const clean = cleanForSpeech(text);
      if (!clean) return resolve();
      const myId = ++speakId;
      speechSynthesis.cancel();
      // Short chunks avoid Android Chrome cutting off long utterances
      const chunks = clean.match(/[^.!?।॥\n]+[.!?।॥]?/g) || [clean];
      let i = 0;
      const next = () => {
        if (myId !== speakId) return resolve();           // superseded or stopped
        if (i >= chunks.length) { if (state === 'speaking') setState('idle'); return resolve(); }
        const piece = chunks[i++].trim();
        if (!piece) return next();
        const lang = detectLang(piece);
        const u = new SpeechSynthesisUtterance(piece);
        u.lang = LANG[lang];
        const v = pickVoice(lang); if (v) u.voice = v;
        u.rate = 0.98; u.pitch = 1.1; u.volume = 1;      // slightly higher pitch keeps the voice feminine
        u.onend = next; u.onerror = next;
        speechSynthesis.speak(u);
      };
      setState('speaking');
      setTimeout(next, 80);                               // Android Chrome drops speak() right after cancel()
    });
  }
  // Voice button: cycle through the installed voices for the current language and play a sample
  function cycleVoice() {
    if (!('speechSynthesis' in window)) { addMsg('ai', 'Voice output is not supported in this browser.', 'err'); return; }
    loadVoices();
    const lang = langChoice === 'auto' ? lastLang : langChoice;
    const pool = voicesFor(lang);
    if (!pool.length) {
      addMsg('ai', `No ${LANG_NAME[lang]} voice is installed on this phone. Install it in Android Settings → System → Languages → Text-to-speech output → Google → Install voice data.`, 'err');
      return;
    }
    const idx = (pool.indexOf(pickVoice(lang)) + 1) % pool.length;
    try { localStorage.setItem('dipa_voice_' + lang, pool[idx].name); } catch {}
    voiceOn = true; muteBtn.classList.remove('off');
    addMsg('ai', `${LANG_NAME[lang]} voice ${idx + 1} of ${pool.length} (${pool[idx].name}). Tap the voice button again to try the next one.`);
    speak(SAMPLE[lang]);
  }
  $('#voiceBtn').addEventListener('click', cycleVoice);

  /* ---------- chat ---------- */
  async function ask(text) {
    if (busy || !text.trim()) return;
    busy = true;
    stopListening();
    lastLang = detectLang(text);
    addMsg('user', text);
    history.push({ role: 'user', text });
    input.value = '';
    setState('thinking');
    const bubble = typingBubble();
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-20), lang: langChoice })
      });
      const j = await r.json().catch(() => ({}));
      bubble.remove();
      if (!r.ok || !j.reply) throw new Error(j.error || 'Something went wrong.');
      history.push({ role: 'assistant', text: j.reply });
      addMsg('ai', j.reply);
      busy = false;
      await speak(j.reply);
    } catch (e) {
      bubble.remove();
      history.pop(); // keep alternating roles valid
      addMsg('ai', e.message, 'err');
      setState('idle');
    } finally { busy = false; }
  }
  form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });

  /* ---------- speech recognition (microphone) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  function stopListening() { if (rec && listening) { try { rec.stop(); } catch {} } }
  function startListening() {
    if (!SR) { addMsg('ai', 'Voice input is not supported in this browser. Please use Chrome on Android.', 'err'); return; }
    if (busy) return;
    stopSpeaking();
    rec = new SR();
    rec.lang = LANG[langChoice === 'auto' ? lastLang : langChoice];
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = '', failed = false;
    rec.onstart = () => { listening = true; micBtn.classList.add('live'); setState('listening'); };
    rec.onresult = ev => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t; else interim += t;
      }
      input.value = (finalText + interim).trim();
    };
    rec.onerror = ev => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      failed = true;
      const msg = {
        'not-allowed': 'Microphone permission is blocked. Tap the lock icon in Chrome\'s address bar → Permissions → allow Microphone. (The site must use HTTPS.)',
        'service-not-allowed': 'Microphone permission is blocked. Tap the lock icon in Chrome\'s address bar → Permissions → allow Microphone.',
        'audio-capture': 'No microphone was found or another app is using it.',
        'network': 'Voice recognition needs an internet connection. Please check your connection.',
        'language-not-supported': 'Voice recognition for this language is not available on this phone. You can still type.'
      }[ev.error] || ('Voice input error: ' + ev.error);
      addMsg('ai', msg, 'err');
    };
    rec.onend = () => {
      listening = false; micBtn.classList.remove('live');
      if (!busy && state === 'listening') setState('idle');
      const t = (finalText || input.value).trim();
      if (t) ask(t);
      else if (!failed) addMsg('ai', 'I did not catch that. Tap the microphone and try again.');
    };
    try { rec.start(); } catch {}
  }
  micBtn.addEventListener('click', () => listening ? stopListening() : startListening());

  /* ---------- controls ---------- */
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active'); langChoice = c.dataset.lang;
    input.placeholder = { auto: 'Talk to DIPA…  বলুন  /  बोलिए', en: 'Talk to DIPA…', bn: 'DIPA-কে বলুন…', hi: 'DIPA से बोलिए…' }[langChoice];
  }));
  muteBtn.addEventListener('click', () => {
    voiceOn = !voiceOn; muteBtn.classList.toggle('off', !voiceOn);
    if (!voiceOn) stopSpeaking();
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopSpeaking(); stopListening(); } });

  /* ---------- boot ---------- */
  fetch('/api/health').then(r => r.json()).then(j => {
    statusDot.classList.toggle('ok', !!j.configured);
    if (!j.configured) addMsg('ai', 'Backend is running but GEMINI_API_KEY is not configured yet.', 'err');
  }).catch(() => addMsg('ai', 'Cannot reach the backend server.', 'err'));

  $('#bootBtn').addEventListener('click', () => {
    $('#boot').classList.add('hide');
    addMsg('ai', INTRO);
    // User gesture just happened, so audio is allowed
    loadVoices();
    speak(INTRO);
  });

  /* ---------- holographic orb ---------- */
  const cv = $('#orb'), ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    const r = cv.getBoundingClientRect(); W = r.width; H = r.height;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize); resize();
  // Tap the orb: stop DIPA while she speaks, or start listening when idle
  cv.addEventListener('click', () => { if (state === 'speaking') stopSpeaking(); else if (state === 'idle') startListening(); });

  const parts = Array.from({ length: 70 }, () => ({ a: Math.random() * 6.283, r: .55 + Math.random() * .75, s: (Math.random() - .5) * .012, z: Math.random() }));
  let amp = 0, t0 = 0;
  function frame(t) {
    t0 = t / 1000;
    const cx = W / 2, cy = H / 2, base = Math.min(W, H) * .27;
    const target = { idle: .12, listening: .55, thinking: .35, speaking: .75 }[state];
    const wobble = state === 'speaking' ? (Math.sin(t0 * 13) + Math.sin(t0 * 7.3) + 2) / 4 : state === 'listening' ? (Math.sin(t0 * 9) + 1) / 2 : 1;
    amp += (target * wobble - amp) * .12;
    const speed = state === 'thinking' ? 3.2 : state === 'idle' ? 1 : 1.8;
    const hot = state === 'listening' ? '255,90,140' : '39,196,255';

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // glow
    const g = ctx.createRadialGradient(cx, cy, base * .2, cx, cy, base * (2 + amp));
    g.addColorStop(0, `rgba(${hot},.55)`); g.addColorStop(.35, `rgba(10,132,255,.22)`); g.addColorStop(1, 'rgba(2,10,28,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, base * (2 + amp), 0, 7); ctx.fill();

    // core
    const R = base * (.62 + amp * .22);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    core.addColorStop(0, 'rgba(220,250,255,.95)'); core.addColorStop(.5, `rgba(${hot},.55)`); core.addColorStop(1, 'rgba(10,132,255,0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();

    // rotating rings
    const rings = [[1.0, 2, .9, 0], [1.28, 1, .6, 1], [1.6, 1.5, .45, 2], [1.95, 1, .3, 3]];
    for (const [k, w, al, i] of rings) {
      const rr = base * k * (1 + amp * .06), dir = i % 2 ? -1 : 1, rot = t0 * speed * dir * (.35 + i * .12);
      ctx.strokeStyle = `rgba(${hot},${al})`; ctx.lineWidth = w;
      ctx.shadowColor = `rgba(${hot},1)`; ctx.shadowBlur = 12;
      ctx.setLineDash(i === 1 ? [6, 10] : i === 3 ? [2, 8] : [rr * 1.2, rr * .35]);
      ctx.beginPath(); ctx.arc(cx, cy, rr, rot, rot + 6.283 * (i === 0 ? .85 : 1)); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.shadowBlur = 0;

    // waveform ring (reacts to state)
    ctx.strokeStyle = 'rgba(125,243,255,.9)'; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = i / 120 * 6.283, n = Math.sin(a * 6 + t0 * 4 * speed) * Math.sin(a * 3 - t0 * 2.3);
      const rr = base * 1.12 + n * base * .16 * (.25 + amp * 1.4);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    // particles
    for (const p of parts) {
      p.a += p.s * speed;
      const rr = base * (p.r + Math.sin(t0 + p.z * 9) * .04 + amp * .1);
      const x = cx + Math.cos(p.a) * rr * 1.25, y = cy + Math.sin(p.a) * rr * .92;
      ctx.fillStyle = `rgba(${hot},${.25 + p.z * .6})`;
      ctx.beginPath(); ctx.arc(x, y, .8 + p.z * 1.6, 0, 7); ctx.fill();
    }

    // HUD tick marks
    ctx.strokeStyle = 'rgba(39,196,255,.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * 6.283 + t0 * .08, r1 = base * 2.15, r2 = r1 + (i % 5 ? 4 : 9);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
