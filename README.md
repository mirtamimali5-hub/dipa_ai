# DIPA AI

DIPA is a female, professional AI assistant with a futuristic blue holographic interface, built mobile-first for Android.
Languages: **Bengali, Hindi and English**. Powered by Google Gemini through a secure Node.js backend.
Zero npm dependencies, needs Node.js 18+.

> "Hello! I am DIPA, your personal AI assistant."

## Features
- Animated holographic orb (standby / listening / processing / speaking). Tap it to stop DIPA talking, or to start listening.
- Chat in Bengali, Hindi and English (Auto, or pick a language)
- Microphone voice input (Chrome on Android)
- Spoken replies in a female voice, with a **voice button** to switch between the voices installed on your phone, and a mute button
- Installable on the home screen (full-screen app)
- Gemini API key stays on the server; automatic fallback to other Gemini models if one is busy

---

## Deploy on Replit (simple mobile steps)
1. Open **replit.com** in Chrome on your phone (or computer) and sign in.
2. **Create App → Import from ZIP / Upload** this project (or create a Node.js Repl and upload all files, keeping the `public` folder).
3. Open **Secrets** (the lock icon in Tools). Add:
   - Key: `GEMINI_API_KEY`  Value: your key from https://aistudio.google.com/apikey
   - (optional) Key: `GEMINI_MODEL`  Value: `gemini-2.5-flash`
4. Tap **Run**. The console should print `DIPA AI running ... (Gemini key loaded)`.
5. Check the key works: open `YOUR-REPLIT-URL/api/health?deep=1` — you should see `"gemini":"ok"`.
6. To keep it online 24/7, tap **Deploy** (Autoscale or Reserved VM). Replit Secrets are available to deployments automatically; if not, re-add the secret in the Deployment settings.

Your Replit URL is `https://....replit.app` (HTTPS), which is what the microphone needs.

## Use on Android
1. Open the `https://` URL in **Chrome for Android**.
2. Tap **INITIALIZE DIPA** (browsers only allow sound after a tap). DIPA greets you.
3. Tap the **microphone**, allow the permission when Chrome asks, and speak. Pick বাংলা / हिन्दी first for those languages (Auto follows the language of your last message, starting with English).
4. Tap the **person icon** to switch DIPA's voice until you find the female voice you like; it is remembered per language.
5. Chrome menu **⋮ → Add to Home screen** (or *Install app*) for a full-screen app.

### Voice tips
Voices come from the phone. For Bengali and Hindi: Settings → System → Languages → *Text-to-speech output* → Google → **Install voice data**. Voice names don't say male/female on Android, so use the voice button to choose.

### Troubleshooting
| Problem | Fix |
|---|---|
| "key was rejected" | Re-copy the key into Secrets as `GEMINI_API_KEY`, restart |
| "free quota is used up" | Wait a minute, or use another key |
| Mic does nothing / permission message | Use the `https://` URL; Chrome ⋮ → Site settings → Microphone → Allow |
| "language not available" for voice input | Install the language in Google app / Gboard voice typing, or type instead |
| No sound | Tap INITIALIZE DIPA first; check the speaker button is on and media volume is up |

## Run locally
1. `cp .env.example .env` and put your key in `GEMINI_API_KEY`
2. `npm start`, then open http://localhost:3000
(Microphone works on `localhost`; on a phone you need HTTPS, e.g. `npx cloudflared tunnel --url http://localhost:3000`.)

## Files
- `server.js` – backend: serves `public/`, proxies Gemini, rate limit, model fallback, `/api/health`
- `public/` – UI (orb, chat, mic, speech), `manifest.webmanifest`, icons
- `.replit` – Replit run/deploy config
