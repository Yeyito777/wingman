# ☀️ Morning checklist (Sat Oct 17)

Built overnight; every commit is after Fri 22:00 EDT. Repo: `~/Workspace/active-development/wingman` (local only,
**not pushed**).

## Try it in 2 minutes

```bash
cd ~/Workspace/active-development/wingman
bun install && secrets run --allow GEMINI_API_KEY -- bun run dev     # terminal 1
bun run tunnel                                                        # terminal 2 → https://….trycloudflare.com
```

On the laptop open the tunnel URL → **Create a stage demo** → scan the phone QR with your phone → **I'm ready** →
on the laptop **Open stage view**, join as "Sam", then press → five times while following [DEMO.md](DEMO.md).

## What works (verified overnight)

- ✅ Phone page: setup + consent, motion/location/mic permissions, fall detector, GPS, heartbeats, wake lock, spoken
  check-ins with voice recording → WAV upload, verdict screen, **bystander mode** with siren + PIN pad, End night
  (deletes data).
- ✅ Buddy page: join via link/QR, live status + reasons, map, escalation ladder with countdown, **full-screen alarm
  takeover**, I'm on my way / Call / 911 / Escalate / They're OK, event log, SMS card.
- ✅ Demo panel + **stage view** (projector dashboard + clicker-driven storyline; plays the slurred clip aloud).
- ✅ **Gemini scoring of real audio** with your key: the slurred clip → impaired 0.6 "slurred speech, couldn't remember
  where they are"; the clear clip → OK. `gemini-flash-lite-latest`, ~2 s.
- ✅ Tests: `bun test` → 27 pass (risk engine, escalation machine, 4 end-to-end storyline tests, dead-man's switch),
  and the optional live-Gemini test passes. `bun run screenshots` drives all pages in headless Chromium with zero
  JS errors and no layout overflow → `docs/screenshots/`.
- ✅ `bun run rehearse` plays the exact stage storyline at real pitch pace in headless Chromium (phone page + stage
  view + clicker keys): L1 fires 11 s after clicker ④, L2 +15 s, L3 +15 s, ack + PIN resolves. It never alerts early.
  The browser-recorded WAV was also accepted by live Gemini.
- ✅ Cloudflare tunnel tested (share links pick up the https host; WebSockets work through it).
- ✅ Docker image builds and serves (tested with podman).

## What's mocked / not yet verified

- ⚠️ **Not tested on a real phone yet** (only headless Chromium with fake mic/GPS). **Do this first**: iPhone Safari
  and an Android if you can borrow one. Watch for: the motion permission prompt, speech playing, mic recording, the
  siren with the silent switch.
- ⚠️ Level-3 SMS is **simulated** (no Twilio keys). It's clearly labelled "SIMULATED" in the UI.
- ⚠️ The demo storyline's walk-away, fall and slurred answer are **triggered from the demo controls** (canned and
  deterministic). Step 1's check-in uses your real voice + Gemini.
- ⚠️ The fall threshold (2.6 g + stillness) is tuned by reasoning, not tested on a real drop. Try dropping the phone
  onto a bed. If it's flaky, use the button.
- ⚠️ **The OpenAI key has no credits** (HTTP 429 when tested). The fallback chain handled it correctly (→ mock), but
  effectively it's Gemini → offline mock. Note that `OPENAI_API_KEY` is also exported in your shell, so a plain
  `bun run dev` puts OpenAI first. **Always start with `secrets run --allow GEMINI_API_KEY -- bun run dev`** (Gemini
  goes first when its key is present), or set `SCORER=gemini`.

## Things only you can do

1. **GitHub:** create a repo (public) → `git remote add origin … && git push -u origin main`. Commit times prove it
   was built during the event.
2. **Gemini key:** ✅ already in `secrets` (`GEMINI_API_KEY`, free tier). For the deploy, put it in the VPS `.env`.
3. **Twilio (optional, about 15 min):** free trial → buy or get a trial number → **verify your own phone number** (trial
   only texts verified numbers) → set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and put your
   number as the emergency contact. Then L3 really texts your phone on stage, which is a strong moment.
4. **Vultr:** create the account (MLH credits?) and follow [DEPLOY.md](DEPLOY.md). It's about 20 min with Docker + Caddy.
5. **GoDaddy domain** (MLH prize): something like `wingman-guardian.tech`, `nightwingman.xyz` or `asksforyou.com`.
   Point an A record at the VPS (DEPLOY.md §2).
6. **Record the backup video** (DEMO.md → Backup plan) once it's deployed.
7. **Devpost:** paste [DEVPOST.md](DEVPOST.md), fill in the links, upload 3–4 screenshots from `docs/screenshots/`.
   **Hard deadline Sun 08:00 EDT.**

## Top 5 next tasks for Saturday (ranked by impact)

1. **Real-phone shakedown (iPhone first).** Run the full DEMO.md script on your actual phone over the tunnel, and fix
   whatever iOS throws (permissions, audio unlock, speech). Everything else depends on this.
2. **Deploy to Vultr + GoDaddy domain + Twilio trial.** This unlocks two MLH prizes, makes L3 send a real text
   (great on stage), and removes the tunnel as a point of failure.
3. **Rehearse the 4-minute pitch 3+ times with the clicker,** tune the L1→L2/L2→L3 timers in the panel to your pacing,
   and record the backup video.
4. **Push to GitHub + finish Devpost** (screenshots, video, links). Do it early, then just update it.
5. **Polish (only if 1–4 are done):** optionally a real drop-the-phone fall on stage, a personalised "sober baseline"
   check-in, or a service worker for PWA install. Don't add features that risk the demo.
