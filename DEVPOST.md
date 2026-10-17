# Wingman: the night-out guardian that never needs you to press SOS

**Tagline:** When you can't ask for help, Wingman asks for you.

**Challenges:** Project KAZE · Best Solo Hack · AI for Social Impact · Best Use of Gemini API (MLH) · Best Use of
Vultr (MLH) · Best Domain Name from GoDaddy Registry (MLH)

---

## Inspiration

Every personal-safety app has the same assumption baked in: **you press the button.** But the situations that scare
us most on a night out are the ones where you *can't*: a spiked drink, being far drunker than you realized, hitting
your head. You can't unlock a phone, you can't explain where you are, and often you don't even know something is
wrong.

KAZE framed this as a gap: between the moment someone becomes unable to protect themselves and the moment someone
else realizes help is needed. Friends usually *would* help; they just don't know yet. We wanted to shrink that gap
from "the next morning" to "about a minute", without asking the person to do anything.

## What it does

Wingman is a web app (a PWA, with no download and no account) that you start when you go out:

- **Opt in for tonight.** Set a PIN, add medical info (allergies, meds) and an emergency contact, then share a link or
  QR code with 1–3 friends. They open it on any phone and become your **buddies**.
- **It watches passively.** Using only browser APIs, the phone detects **falls** (an impact followed by stillness),
  tracks **distance from your group** (with GPS uncertainty subtracted, so indoor jitter doesn't cause alarms), notices
  **stillness** and an **untouched phone**, and runs a **dead-man's switch**: if the phone suddenly goes silent (dead
  battery, taken), that's a signal too.
- **It talks to you.** Every 30 minutes, and whenever something looks off, your phone chimes and *asks out loud*:
  "Hey, quick check-in: where are you, and who are you with?" You just answer. **Gemini listens to the audio** and
  judges whether you sound coherent and oriented or slurred and confused, with a one-line reason a friend can
  understand.
- **It explains itself.** A deterministic risk engine combines everything into a score with readable reasons:
  *"check-in answer sounded impaired: slurred speech + fall detected 2 min ago + 310 m from your group."*
- **It escalates on its own:**
  1. **Buddies:** their screens take over with an alarm, your live location on a map, the reasons, and *I'm on my
     way* / *Call* buttons. Everyone sees who's coming.
  2. **Bystanders:** if no buddy responds, *your* phone turns into a flashing, siren-blaring sign: **"THIS PERSON MAY
     NEED HELP"**, with a giant *Call 911* button and your medical info for first responders. Cancelling needs your
     PIN, so a confused person can't dismiss it by accident.
  3. **Emergency contact:** finally, a text (and optionally a call) to your emergency contact with the reasons and a
     map link.
- **It stands down gracefully.** A clear check-in answer, your PIN, or a buddy confirming they're with you resolves
  the alert. The whole night is in a shared event log.
- **Privacy is built in:** opt-in per night, location visible only during the session (or only on alert, your choice),
  medical info revealed only during an alert, **no database**, and everything deleted when you end the night.

## How we built it

- **Server:** TypeScript on **Bun**: one process serving HTTP, a WebSocket push channel, and the bundled frontend
  (Bun's HTML imports, no separate build step). Sessions live in memory by design.
- **Risk engine + escalation ladder:** two **pure, deterministic functions** (signals → score + reasons;
  state + event → state + effects), driven by a 250 ms tick. They're unit-tested, and the whole demo storyline runs as
  an end-to-end test with a simulated phone and buddy over real HTTP/WebSocket connections.
- **AI check-ins:** the phone records the reply with MediaRecorder, converts it in the browser to 16 kHz WAV, and the
  server sends the **audio straight to the Gemini API** (`gemini-flash-lite-latest`, about 2 s) with a JSON response
  schema: transcript, responded, coherent, impairment 0–1, signs, reason. If Gemini is rate-limited or down, it tries
  the next Gemini model, then OpenAI (transcribe + small model), then a deterministic offline heuristic, so a check-in
  is always scored. Results are cached by content hash.
- **Phone sensors (all in the browser):** DeviceMotion (with the iOS permission prompt), Geolocation, Screen Wake Lock,
  Web Audio (chimes, alarm and siren), Speech Synthesis (the spoken question), Vibration, Web Share, and `sendBeacon`
  so the server can tell "screen locked" apart from "phone died".
- **Maps:** Leaflet + OpenStreetMap.
- **Level 3:** a pluggable notifier: **Twilio** SMS/voice when configured, otherwise a clearly labelled simulation.
- **Demo tooling:** Gemini TTS generated the demo voice clips. There's a control panel, plus a "stage view" (the buddy
  dashboard for the projector) whose storyline advances with a presentation clicker, because this is a solo hack.
- **Deploy:** Docker image, served on a **Vultr** VPS behind Caddy (automatic HTTPS) on a **GoDaddy** domain.
  Cloudflare quick tunnels for phone testing during development.

## Challenges we ran into

- **Phones only expose sensors over HTTPS, and only after a tap.** iOS needs `DeviceMotionEvent.requestPermission()`
  called synchronously inside a tap, before any network request, plus an audio and speech "unlock" for later sounds.
  The whole setup flow is built around one tap.
- **Browsers suspend pages when the screen locks.** A naive dead-man's switch would alert every time you pocket your
  phone. We send a beacon when the page goes to the background so the server can distinguish "locked" from "silent".
- **Audio formats:** Chrome records WebM/Opus and Safari records MP4/AAC. Decoding and re-encoding to WAV in the
  browser made every AI engine happy.
- **Avoiding false alarms** without missing real ones: we tuned weights so no single signal escalates. A fall alone
  just triggers a check-in, and it takes corroboration (a slurred or missed answer) to alert friends. Our end-to-end
  test caught a subtle case where "fall + walking away" crossed the threshold before the person was asked.
- **Determinism for a live demo:** the late-night risk factor made the storyline behave differently at 3 AM than at
  10 AM, so demo sessions pin their clock. The scripted path never depends on a network call.

## Accomplishments that we're proud of

- The full loop works end to end on real phones: passive sensing → spoken AI check-in → explainable risk → three-level
  escalation → PIN-protected de-escalation.
- **Gemini hears the difference** between a clear answer and a slurred one from raw audio in about 2 seconds.
- Every alert explains itself in plain English. There's no mystery score.
- A tested core: risk-engine and state-machine unit tests, an end-to-end storyline test asserting the exact
  escalation sequence, and a headless-browser run of every screen that fails on JS errors or layout overflow.
- Privacy that's structural: the server has no database to leak.

## What we learned

- Safety UX is about the *other* people: the friend who needs to know where to go, and the stranger who needs to know
  what to do. Bystander mode came from asking "who is physically next to them right now?"
- Multimodal models are good at judging *how* something was said, not just what was said.
- Keeping the decision logic deterministic and the AI as just one input makes the system explainable and testable.

## What's next for Wingman

- **Native apps** (iOS/Android) for true background monitoring and OS-level fall detection; the same server and engine.
- **Wearables:** heart rate and skin temperature from watches as extra signals.
- **Venue partnerships:** bars and campus security as an optional "nearby responder" level.
- **Text-to-911 / RapidSOS** integration for level 3, with location.
- **Smarter check-ins:** personalised baselines (how *you* sound sober) and multilingual prompts.
- A user study with student groups on false-alarm rates and real-world tuning of the thresholds.

## Built with

`typescript` · `bun` · `websockets` · `gemini-api` · `gemini-tts` · `openai` (fallback) · `leaflet` ·
`openstreetmap` · `web-audio-api` · `devicemotion` · `geolocation` · `mediarecorder` · `speech-synthesis` ·
`wake-lock-api` · `twilio` · `docker` · `caddy` · `vultr` · `godaddy` · `cloudflare-tunnel` · `playwright`

---

### Real vs. simulated (for judges)

| Part | Status |
|---|---|
| Fall detection, location, heartbeats, touch, battery, wake lock | **Real**, from the phone's browser sensors |
| Spoken check-in question + voice recording | **Real** (speech synthesis + MediaRecorder) |
| AI scoring of the voice reply | **Real** Gemini audio understanding (falls back to OpenAI, then an offline heuristic) |
| Risk engine, escalation ladder, buddy alerts, bystander mode, PIN | **Real** |
| Level-3 SMS | **Real via Twilio** when keys are configured, otherwise **simulated** and labelled as such in the UI |
| On-stage storyline | Uses **demo controls** to trigger the walk-away, the fall, and a pre-recorded slurred answer (an AI-generated voice clip) so the 4-minute demo is repeatable. The step-1 live check-in uses the presenter's real voice |
| Timers | Accelerated in demo mode (15 s per level instead of minutes) |

**Links:** GitHub: `<repo URL>` · Live: `https://<domain>` · Demo video: `<YouTube URL>`
