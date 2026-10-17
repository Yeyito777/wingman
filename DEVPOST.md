# Wingman: everyone is everyone's wingman

**Tagline:** When you can't ask for help, your friends' phones ask for you.

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

**Everyone is everyone's wingman.** Friends going out together join tonight's group with a 6-letter code. Every member
is both guarded and a guardian: each phone watches its owner, and when one of them can't ask for help, every other
phone in the group asks for them.

- **Opt in for tonight.** Each member sets a PIN, optional medical info (allergies, meds) and an emergency contact,
  and consents to being guarded and to guarding the others. No accounts; join by QR code, link or code.
- **It watches passively.** The Wingman iPhone app detects **falls** (an impact followed by stillness), tracks
  **distance from the group** (to the nearest friend, with GPS uncertainty subtracted so indoor jitter doesn't cause
  alarms), notices **stillness** and an **untouched phone**, and runs a **dead-man's switch**: a phone that suddenly
  goes silent (dead battery, taken) is a signal too, while one that reports being locked first isn't.
- **It talks to you.** Every 30 minutes, whenever something looks off, or when a friend taps *ping*, your phone
  chimes and *asks out loud*: "Hey, quick check-in: where are you, and who are you with?" You just answer. **Gemini
  listens to the audio** and judges whether you sound coherent and oriented or slurred and confused, with a one-line
  reason a friend can understand.
- **It explains itself.** A deterministic risk engine combines everything into a score with readable reasons:
  *"check-in answer sounded impaired: slurred speech + fall detected 2 min ago + 310 m from your group."*
- **It escalates on its own, per member** (several people can be in alert at once):
  1. **The whole group:** every other member's phone alarms, with your live location, the reasons, and *I'm on my
     way* / *Found & OK* / *Call*. Everyone sees who's coming, so the group doesn't all run.
  2. **Bystanders:** if nobody responds, *your* phone turns into a flashing, siren-blaring sign: **"THIS PERSON MAY
     NEED HELP"**, with a giant *Call 911* button and your medical info. Cancelling needs your PIN, so a confused
     person can't dismiss it by accident.
  3. **Emergency contact:** a text (and optionally a call) to your emergency contact with the reasons and a map link.
- **It stands down gracefully.** A clear check-in answer, your PIN, or a friend confirming *found & OK* in person
  resolves the alert. The whole night is in a shared event log.
- **Privacy is built in:** opt-in per person, location shared only for the night (or only on alert), medical info
  revealed to friends only during your alert, **no database**, and everything deleted when anyone ends the night.

## How we built it

- **iPhone app:** native, built with Expo / React Native: background location, motion, voice recording (`.m4a`),
  text-to-speech for the spoken question, local alerts and the bystander screen.
- **Server:** TypeScript on **Bun**: one process serving a JSON REST API, a WebSocket push channel, and the projector
  stage view. A typed wire protocol (`shared/protocol.ts`) is imported by both the server and the app. Groups live in
  memory by design; each member authenticates with a per-member secret key.
- **Risk engine + escalation ladder:** two **pure, deterministic functions** (signals → score + reasons;
  state + event → state + effects), run per member on a 250 ms tick, with alerts fanned out to every other member.
  They're unit-tested, and the whole demo storyline runs as an end-to-end test with three members connected over
  real HTTP/WebSocket.
- **AI check-ins:** the app records the reply (AAC `.m4a`) and the server sends the **audio straight to the Gemini
  API** (`gemini-flash-lite-latest`, about 2 s) with a JSON response schema: transcript, responded, coherent,
  impairment 0–1, signs, reason. If Gemini is rate-limited or down it tries the next Gemini model, then OpenAI
  (transcribe + small model), then a deterministic offline heuristic, so a check-in is always scored.
- **Maps:** Leaflet + OpenStreetMap on the stage view.
- **Level 3:** a pluggable notifier: **Twilio** SMS/voice when configured, otherwise a clearly labelled simulation.
  Optional Expo push for alerts to backgrounded phones.
- **Demo tooling:** simulated friends (Sam, Maya, Leo) who move, heartbeat and answer check-ins on the server; Gemini
  TTS generated the demo voice clips; a projector "stage view" whose storyline advances with a presentation clicker,
  because this is a solo hack. Either the real phone or a simulated friend can be the one in trouble.
- **Deploy:** Docker image on a **Vultr** VPS behind Caddy (automatic HTTPS) on a **GoDaddy** domain. Cloudflare quick
  tunnels for phone testing during development.

## Challenges we ran into

- **Phones only expose sensors over HTTPS, and only after a tap.** iOS needs `DeviceMotionEvent.requestPermission()`
  called synchronously inside a tap, before any network request, plus an audio and speech "unlock" for later sounds.
  The whole setup flow is built around one tap.
- **Watcher vs. watchee was the wrong model.** Our first version had one "person" and several "buddies". Testing it
  on an iPhone made the asymmetry feel wrong: nobody wants to be the one being babysat, and on a night out the
  designated buddy can just as easily be the one who gets into trouble. We rebuilt it as a fully connected group: every member runs the same risk engine and ladder, and
  alerts fan out to everyone else.
- **Phones go quiet in your pocket.** A naive dead-man's switch would alert every time you lock your phone. The app
  reports "background / locked" before going quiet so the server can distinguish "locked" from "silent".
- **Audio formats:** iOS records AAC in an `.m4a` container under several MIME labels; we verified Gemini with real
  `.m4a` files and normalise the type on the server.
- **Avoiding false alarms** without missing real ones: we tuned weights so no single signal escalates. A fall alone
  just triggers a check-in, and it takes corroboration (a slurred or missed answer) to alert friends. Our end-to-end
  test caught a subtle case where "fall + walking away" crossed the threshold before the person was asked.
- **Determinism for a live demo:** the late-night risk factor made the storyline behave differently at 3 AM than at
  10 AM, so demo sessions pin their clock. The scripted path never depends on a network call.

## Accomplishments that we're proud of

- The full loop works end to end on real phones: passive sensing → spoken AI check-in → explainable risk → alerts on
  every friend's phone → bystander mode → emergency contact → de-escalation by a friend or the PIN.
- **Gemini hears the difference** between a clear answer and a slurred one from raw audio in about 2 seconds.
- Every alert explains itself in plain English. There's no mystery score.
- A tested core: risk-engine and state-machine unit tests, an end-to-end group storyline test (three WebSocket members)
  asserting the exact escalation sequence and the fan-out, a live-Gemini test with a real iOS `.m4a`, and a
  headless-browser run of the stage view that fails on JS errors, overflow, or anything covering the alarm.
- Privacy that's structural: the server has no database to leak.

## What we learned

- Safety UX is about the *other* people: the friend who needs to know where to go, and the stranger who needs to know
  what to do. Bystander mode came from asking "who is physically next to them right now?"
- Multimodal models are good at judging *how* something was said, not just what was said.
- Keeping the decision logic deterministic and the AI as just one input makes the system explainable and testable.

## What's next for Wingman

- **Android app** and OS-level fall detection (Apple Watch / Wear OS); the same server and engine.
- **Wearables:** heart rate and skin temperature from watches as extra signals.
- **Venue partnerships:** bars and campus security as an optional "nearby responder" level.
- **Text-to-911 / RapidSOS** integration for level 3, with location.
- **Smarter check-ins:** personalised baselines (how *you* sound sober) and multilingual prompts.
- A user study with student groups on false-alarm rates and real-world tuning of the thresholds.

## Built with

`typescript` · `bun` · `react-native` · `expo` · `websockets` · `gemini-api` · `gemini-tts` · `openai` (fallback) · `leaflet` ·
`openstreetmap` · `web-audio-api` · `twilio` · `docker` · `caddy` · `vultr` · `godaddy` · `cloudflare-tunnel` · `playwright`

---

### Real vs. simulated (for judges)

| Part | Status |
|---|---|
| Location, motion/falls, heartbeats, app state, battery | **Real**, from the phone |
| Spoken check-in question + voice recording | **Real** (text-to-speech + recording on the phone) |
| AI scoring of the voice reply | **Real** Gemini audio understanding (falls back to OpenAI, then an offline heuristic) |
| Risk engine, per-member ladders, group fan-out, bystander mode, PIN, found & OK | **Real** |
| Level-3 SMS | **Real via Twilio** when keys are configured, otherwise **simulated** and labelled as such |
| Push to backgrounded phones | Real via Expo push when enabled (`EXPO_PUSH=1`); otherwise in-app alerts over WebSocket |
| Sam, Maya and Leo on stage | **Simulated friends** (server-side members that move, heartbeat and answer check-ins). The presenter's phone is a real member |
| On-stage storyline | Uses **demo controls** to trigger the drift, the fall, and a pre-recorded slurred answer (an AI-generated voice clip) so the 4-minute demo is repeatable. The step-1 check-in uses the presenter's real voice |
| Timers | Accelerated in demo mode (15 s per level instead of minutes) |

**Links:** GitHub: `<repo URL>` · Live: `https://<domain>` · Demo video: `<YouTube URL>`
