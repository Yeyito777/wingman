# Wingman: 4-minute pitch + demo script

**Format:** 4 min pitch/demo + 1 min Q&A. Solo presenter.
**Setup:** the projector shows the laptop's **stage view** (Sam the buddy's dashboard plus a storyline sidebar). The
person's phone is in your hand. A presentation clicker (or the → key) advances the story.

Everything on the scripted path is deterministic: canned answers are scored by the deterministic engine, and the
timers are fixed (L1→L2 15 s, L2→L3 15 s). The only live-AI moment is step 1, and its failure mode is harmless:
if Gemini is down, the scorer falls back and the answer still counts as OK.

---

## T-15 min: setup checklist

1. **Server:** `secrets run --allow GEMINI_API_KEY -- bun run dev` (or use the deployed `https://<domain>`).
2. **HTTPS for the phone:** `bun run tunnel` in a second terminal and copy the `https://….trycloudflare.com` URL.
   Skip this if you're using the deployed domain.
3. **Laptop:** open `<URL>/` → **Create a stage demo** (bottom link). The demo panel opens.
   - Check the header badge: `AI: gemini (gemini-flash-lite-latest) · L3: simulated` (or `twilio`).
   - Click **🎬 Open stage view** → move that tab to the projector → **F11** full screen.
   - In the stage view, click into the dashboard: name **Sam** → **I've got their back**. This arms the alarm sound.
4. **Phone:** scan the **📱 Person's phone** QR (in the stage sidebar or demo panel) → **I'm ready** → allow
   **Motion**, **Location**, **Microphone**. The Watching row should show ✓ motion, ±N m location, ✓ mic.
   - Volume **max**. iPhone: ring/silent switch **off**, and Settings › Display › Auto-Lock **Never**
     (iOS pauses web pages when the screen locks).
5. **Laptop volume up.** The alarm is part of the show.
6. In the stage view press **Shift+R** (reset) so the log starts clean.
7. Rehearse once end to end, then Shift+R again. (`bun run rehearse` runs the same storyline headless as a sanity check.)

> Tip: if the phone page reloads, it shows **Tap to start guarding**. Tap it, since iOS needs a tap to re-enable the
> sensors and sound.

---

## The script (timed)

| Time | You say (roughly) | You do | Audience sees |
|---|---|---|---|
| **0:00–0:30** | "Every safety app has the same flaw: an SOS button. But if your drink is spiked, or you're blackout drunk or unconscious, you can't press a button. KAZE asked how to close the gap between *the moment you can't protect yourself* and *the moment someone notices*. This is **Wingman**: a guardian for your night out that never needs you to press SOS." | Nothing. Stage view shows "Yeyito is OK". | Calm green dashboard |
| **0:30–0:50** | "Before I go out, I start a night: it's a web app, no download. I set a PIN, my medical info and an emergency contact, and share a link with my friends. That's my friend Sam's screen up there." | Hold up the phone (green "You're covered"). | Phone + Sam's dashboard |
| **0:50–1:20** | "Every so often, or when something looks off, Wingman checks in. Out loud." | **Clicker ①** Live check-in. The phone chimes and asks *"Where are you right now, and who are you with?"* Answer clearly: **"I'm at Hack the Valley with my team."** | Phone: ✓ *You sound good*. "**Gemini listened to the actual audio**, not just a transcript." |
| **1:20–1:40** | "Now, 1 AM. I wander off from my friends…" | **Clicker ②** Walk away. | Map: Yeyito drifts away, red dashed line, "310 m from your group". Phone asks *"you've drifted away… who are you with?"* |
| **1:40–1:55** | "…and I go down hard." | **Clicker ③** Fall. *(Rehearsed option: actually drop the phone onto a jacket. It detects impact + 3 s of stillness.)* | Reasons stack up: fall detected · 310 m from your group. Risk climbs. |
| **1:55–2:10** | "Wingman asks again, and this is what I manage to say:" | **Clicker ④** Slurred answer. The laptop **plays the slurred reply out loud** (~11 s, a Gemini-TTS clip); as it ends, it's submitted as the answer. | **Sam's screen erupts**: alarm sound, full-screen *YEYITO MAY NEED HELP*, reasons: *slurred speech, couldn't say where they are + fall + 310 m from your group*. |
| **2:10–2:25** | "Every alert explains itself. No black box: a deterministic risk engine, unit-tested, and an AI that only provides one signal. But Sam's in the bathroom and doesn't see it. 15 seconds later…" | Wait. Point at the countdown. | "Siren + bystander mode on their phone in 12s…" |
| **2:25–2:45** | "…my own phone asks strangers for help." | **Hold the phone up high.** | Phone: flashing red/white **THIS PERSON MAY NEED HELP**, siren, giant **CALL 911**, medical info (penicillin allergy, inhaler). "A stranger knows exactly what to do, and I can't cancel it by accident: it needs my PIN." |
| **2:45–2:55** | "Still nobody? Level 3: my mom gets a text with my location." | Wait for L3 (~15 s after L2). | Dashboard card: *SMS → Mom* with reasons + Google Maps link (labelled SIMULATED unless Twilio is set) |
| **2:55–3:15** | "Sam sees it and taps **I'm on my way**. Everyone sees that, and the ladder pauses. When Sam finds me and I'm OK, I enter my PIN." | **Clicker ⑤** (Sam acks). Then on the phone: **I'm OK** → **1 2 3 4**. | Phone: "Sam is on the way", then siren stops, chime. Dashboard back to green, log shows the whole night. |
| **3:15–3:45** | "Privacy is built in: you opt in per night, friends only see your location during the session, medical info only during an alert, and when you end the night **everything is deleted**, with no database at all. Built solo in 36 hours: TypeScript + Bun, phone sensors straight from the browser, **Gemini audio understanding** for check-ins, Twilio for SMS, deployed on **Vultr** at *<domain>*." | (Optional) tap **End night** on the phone. | Phone: "Night ended. Data deleted." Sam's page: "The night out has ended." |
| **3:45–4:00** | "The moment you need help most is the moment you can't ask for it. **Wingman asks for you.**" | | |

**Without the clicker:** the same buttons are in the demo panel (`/demo/<id>?k=…`): Ask check-in now → Walk away →
Simulate fall → Slurred answer → Buddy: on my way.

### If something goes off-script

- **Step ① doesn't hear you** (noisy room): press **Type instead** on the phone and type the answer, or just move on.
  Step ② starts a fresh scene and clears leftovers.
- **No alarm sound on the laptop:** click once inside the stage dashboard (browsers need a click to allow audio).
- **Phone screen locked or the page reloaded:** unlock → **Tap to start guarding**. The storyline state lives on the
  server, so nothing is lost.
- **Want to rerun:** Shift+R in the stage view (or ⟲ Reset in the panel). People stay connected.

---

## Backup plan

1. **Network dies (venue Wi-Fi):** put the laptop on your phone's hotspot and rerun `bun run tunnel`. If that's
   impossible, run fully local: phone sensors won't work without HTTPS, but the demo panel + stage view work on
   `localhost` with a second browser window as "the phone" (Chrome DevTools → device toolbar → iPhone).
2. **Gemini/OpenAI unavailable or rate-limited:** nothing to do. The scorer falls back automatically, and the scripted
   path never calls an API. The header badge tells you which engine is active.
3. **Pre-recorded video (make it Saturday, ~90 s):**
   - Android: mirror with `scrcpy` and record it; iPhone: QuickTime → New Movie Recording → choose the iPhone as the
     camera (cable).
   - Record the laptop's stage view with OBS (or Kooha / SimpleScreenRecorder on Linux), browser full-screen.
   - Run the exact script above; edit the phone recording side by side with the stage view (OBS can capture both
     sources at once).
   - Export 1080p, keep it **on the laptop desktop** (offline) and upload it as an unlisted YouTube video for Devpost.
4. **Total failure:** screenshots in `docs/screenshots/` walk through the whole story (setup → check-in → alert → bystander → SMS → resolved).

---

## Likely judge questions (crisp answers)

**False positives?** Three layers. (1) No single signal escalates: a fall alone only triggers a check-in, and it takes a
fall *plus* a missed or slurred check-in to alert. (2) GPS uncertainty is subtracted from distances, and a clear answer
clears earlier signals. (3) The first responder is a friend, not 911. A false alarm costs one tap ("they're OK").

**How do you know someone's drink was spiked?** We don't detect drugs; we detect the *consequences*: slurred or
confused speech, a fall, stillness, wandering off alone, a phone that goes silent. Those are what bystanders notice
too, just faster and without needing the person to act.

**Why not just Apple fall detection / Emergency SOS?** It needs an Apple Watch or a hard fall, it calls 911 directly
(which is overkill for "my friend is too drunk"), and it misses the most common case: a spiked drink where you can still
walk but can't think clearly. Wingman works on any phone with a browser, loops in *your* friends first, and uses voice
check-ins to catch impairment that motion sensors can't.

**Privacy?** Opt-in per night. Location is visible only during the session (or only on alert, your choice). Medical
info is revealed only during an alert. There's no database: everything lives in server memory and is deleted when
you end the night or after 12 h. Voice clips are scored and thrown away.

**Battery?** One GPS watch, 5-second heartbeats, and the mic only during a 9-second check-in. Roughly comparable to
having Maps open. Real mode checks in every 30 min. A native app would use OS-level fused location to cut this further.

**iOS limitations?** Safari needs a tap to grant motion and audio (we ask during setup), and it pauses web pages when
the screen locks. We hold a screen wake lock while active, and the server can tell "locked on purpose" from "went
silent". True background monitoring is why the native app is our next step; the server and engine stay the same.

**Can an attacker just cancel it?** Cancelling needs the person's PIN, and wrong PINs lock out. Taking or killing the
phone trips the dead-man's switch: a phone that goes silent is itself an alert signal.

**Why an LLM?** Judging "is this answer coherent and oriented?" from messy, slurred audio is exactly what multimodal
models are good at. We use Gemini Flash-Lite (~2 s), but the AI is only one input to a deterministic, explainable
scoring engine, never the sole decision-maker.

**Scale / cost?** The server is stateless apart from active sessions: one small VPS handles thousands of concurrent
nights (a 250 ms tick per session). A check-in costs a fraction of a cent on Gemini Flash-Lite. Scale out by
sharding sessions; persistence isn't needed by design.

**Why not auto-call 911?** False positives would burden emergency services and erode trust. Friends first, then
bystanders, then family, and 911 is one tap away on every screen. Future: Text-to-911 / RapidSOS integration for
level 3.
