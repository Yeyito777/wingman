# Wingman: 4-minute pitch + demo script

**Format:** 4 min pitch/demo + 1 min Q&A. Solo presenter.
**Pitch line:** *everyone is everyone's wingman.* A group of friends all run Wingman; each phone guards its owner, and
when one of them can't ask for help, **every other phone in the group** asks for them.

**Setup:** the projector shows the laptop's **stage view**: the whole group (you + simulated friends Sam, Maya and Leo
who move and heartbeat on the server), a live map, and a slim presenter dock along the bottom (the storyline steps and
**Next: <step> ▶**). Your iPhone runs the Wingman app and is a real member of the group. A presentation clicker (or →, or a
click on a step / Next ▶) advances the story.

The scripted path is deterministic: canned answers are scored by the deterministic engine, timers are fixed (L1→L2
15 s, L2→L3 15 s). The only live-AI moment is step ①, and its failure mode is harmless (if Gemini is down, the scorer
falls back and the answer still counts as OK). Press **A** in the stage view to score the slurred clip with Gemini for
real instead (labelled "Gemini" on screen; safe: if every engine fails the script decides).

---

## T-15 min: setup checklist

1. **Server:** `secrets run --allow GEMINI_API_KEY -- bun run dev` (or the deployed `https://<domain>`), plus
   `bun run tunnel` for an HTTPS URL if the phone isn't on the deployed domain.
2. **Laptop:** open `<URL>/` → **Presenting? Create a stage demo** (small link at the bottom). The stage view opens:
   move it to the projector → **F11**. Press **D** (or **?**) for presenter details: `AI: gemini`,
   `Emergency SMS: simulated` (or `twilio`), the simulated/phone/story tags on the cards and the key help. Press **D**
   again to hide them before judges look (the choice is remembered).
3. **Phone:** open the Wingman app → **Join** → scan the QR on the stage (or type the 6-letter code). Name **Yeyito**,
   PIN **1234**, medical info, emergency contact **Mom**, consent. Allow location, motion, microphone, notifications.
   Your card appears on the stage and the dock reads **Yeyito's story** (you are the one in trouble by default). The
   simulated friends gather around your phone wherever it is (even with iOS "Precise Location" off), and the map
   follows. Your card should say *With the group*; *Waiting for location…* or *Location is off* means the phone
   isn't sending a fix (check Settings → Wingman → Location: While Using + Precise).
   - Volume max, ring/silent switch **off**, keep the app in the foreground.
4. Click anywhere on the stage once, not on a card (enables the alarm sound: the "Sound off" note under the dock
   disappears), laptop volume up. **Shift+R** (or **Reset ↺** at the end of the dock) resets the demo (friends
   re-gather next to your phone's location).
5. Rehearse once end to end, then Shift+R. (`bun run rehearse` runs the same storyline headless as a sanity check.)

---

## The script (timed)

| Time | You say (roughly) | You do | Audience sees |
|---|---|---|---|
| **0:00–0:30** | "Every safety app has the same flaw: an SOS button. If your drink is spiked or you're blackout drunk, you can't press a button. KAZE asked how to close the gap between *the moment you can't protect yourself* and *the moment someone notices*. This is **Wingman**." | Nothing. | Calm stage: four cards, all **OK**, everyone on the map |
| **0:30–0:55** | "Going out with friends? Everyone joins tonight's group with a code. There's no 'person being watched': **everyone is everyone's wingman**. My phone guards me, and it guards Sam, Maya and Leo. Each of their phones does the same." | Hold up the phone (group screen). | The join code + QR, four member cards |
| **0:55–1:20** | "Every so often, or when something looks off, Wingman checks in. Out loud." | **Clicker ①** Check-in. The phone asks *"where are you right now, and who are you with?"* Answer: **"I'm at Hack the Valley with my team."** | Your card: ✓ check-in OK. "**Gemini listened to the actual audio**." |
| **1:20–1:40** | "Now it's 1 AM. I wander off from everyone…" | **Clicker ②** Drift away. | Map: your pin drifts 350 m off with a red dashed line to the nearest friend: *"310 m from your group"* |
| **1:40–1:55** | "…and I go down hard." | **Clicker ③** Fall. | Your card goes **WATCH**: *fall detected + 310 m from your group*; Wingman asks again |
| **1:55–2:10** | "Wingman asks again, and this is all I manage to say:" | **Clicker ④** Slurred answer. The laptop plays the slurred reply aloud (~11 s), then it's submitted. | **The stage erupts**: *YEYITO MAY NEED HELP*, reasons, ladder. "Sam's, Maya's and Leo's phones are all buzzing right now." |
| **2:10–2:25** | "Every alert explains itself: a deterministic, unit-tested risk engine; the AI is one signal. But they're on the dance floor. 15 seconds later…" | Point at the countdown. | Ladder: *Bystander mode in 12 s* |
| **2:25–2:45** | "…my own phone asks strangers for help." | **Hold the phone up.** | Phone: bystander mode, siren, medical info, Call 911. "I can't cancel it by accident: it needs my PIN." |
| **2:45–2:55** | "Still nobody? My mom gets a text with my location." | Wait for L3. | SMS card: *SMS → Mom* (SIMULATED unless Twilio) |
| **2:55–3:15** | "And it only stops when someone who knows me says so. My friends' phones offer *I'm on my way* and *found & OK*, and I can cancel it myself, but only with **my PIN**, so someone confused, or someone who took my phone, can't." | Enter **1234** on the phone (bystander screen → *I'm OK*). The dock reads **Done ✓**. | Everything back to green |
| **3:15–3:45** | "And it's symmetric: if Maya had gone down, *my* phone would be the one buzzing, with her location and medical info. Privacy is built in: everyone opts in, friends see your medical info only during your alert, and when the night ends everything is deleted, with no database. Built solo in 36 hours: a native iPhone app, a Bun + TypeScript server, **Gemini audio understanding** for check-ins, Twilio for SMS, on **Vultr**." | (Optional) **S** to make Maya the subject and show your phone getting her alert, if time allows. | |
| **3:45–4:00** | "The moment you need help most is the moment you can't ask for it. **Your friends' phones ask for you.**" | | |

**Clicker keys (stage view):** → / Space / PgDn next step · ← step back · **S** cycle who's in trouble (or click a card,
or the "…'s story" button in the dock) · **A** scripted ↔ real-audio answers · **D** / **?** presenter details ·
**Shift+R** reset.

**Dock:** the highlighted step is the one in progress (the last one run), earlier ones are ✓, and **Next: <step> ▶**
says what comes next (**Done ✓ · Reset ↺** at the end). **Mouse:** the steps are clickable. Clicking the upcoming
step (or Next) runs it; clicking a later step runs every step up to it, paced so each lands (e.g. click *Fall* to
play Drift away + Fall); clicking an earlier step rewinds to it without undoing anything (Shift+R for a clean slate).
The story ends at the escalation (bystander mode, then the emergency contact): resolve it with the PIN on the phone,
or Shift+R.

**Variant: Maya is the one in trouble** (shows your phone as the guardian): click Maya's card (or press S), run
②③④. Your phone alerts *"Maya may need help"*; tap **I'm on my way**, then **Found & OK** on the phone.

### If something goes off-script

- **Step ① doesn't hear you** (noisy room): type the answer in the app, or just move on. Step ② starts a fresh scene.
- **No alarm sound on the laptop:** click once on the stage header or dock (browsers need a gesture for audio).
- **Your pin isn't on the map / card says *Waiting for location…*:** on the phone, Settings → Wingman → Location
  (While Using or Always, Precise on), then reopen the app; it starts sending within 5 s. Or run the story with
  Maya as the subject (click her card).
- **The phone app was backgrounded / restarted:** reopen it; it reconnects to the same group (the storyline state
  lives on the server).
- **Want to rerun:** Shift+R. Everyone stays connected.

---

## Backup plan

1. **Network dies:** laptop on the phone's hotspot, rerun `bun run tunnel`. Worst case, run the storyline with Maya as
   the subject: the stage alone tells the whole story with simulated friends (`localhost`, no phone needed).
2. **Gemini unavailable or rate-limited:** nothing to do. The scorer falls back automatically, and the scripted path
   never calls an API. Presenter details (**D**) show the active engine.
3. **Pre-recorded video (~90 s):** record the stage view (OBS) and the phone (QuickTime → New Movie Recording → iPhone)
   running this exact script; keep it on the laptop desktop and as an unlisted YouTube link for Devpost.
4. **Total failure:** `docs/screenshots/` walks through the whole story.

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
walk but can't think clearly. Wingman loops in *your* friends first, and uses voice check-ins to catch impairment that
motion sensors can't.

**Why a group and not one watcher?** Nobody wants to be "the one being babysat", and the designated watcher can just as
easily be the one who gets into trouble. In Wingman everyone opts in on equal terms: you're guarded, and you're a guardian.
Whoever is closest and sober enough answers, and everyone sees who's on the way.

**Privacy?** Opt-in per night, per person (joining requires explicit consent). Location is shared with the group only
during the night (or only on alert, your choice). Medical info and your contact's number are revealed to friends only
during your alert. There's no database: everything lives in server memory and is deleted when
you end the night or after 12 h. Voice clips are scored and thrown away.

**Battery?** One GPS watch, 5-second heartbeats, and the mic only during a 9-second check-in. Roughly comparable to
having Maps open. Real mode checks in every 30 min. A native app would use OS-level fused location to cut this further.

**iOS limitations?** iOS limits background work. The native app reports its app state (foreground / background /
locked) before going quiet, so the server can tell "pocketed on purpose" from "phone died", and alerts reach
backgrounded friends as notifications. Background location keeps distance-from-group working.

**Can an attacker just cancel it?** Cancelling needs the person's PIN, and wrong PINs lock out. Taking or killing the
phone trips the dead-man's switch: a phone that goes silent is itself an alert signal.

**Why an LLM?** Judging "is this answer coherent and oriented?" from messy, slurred audio is exactly what multimodal
models are good at. We use Gemini Flash-Lite (~2 s), but the AI is only one input to a deterministic, explainable
scoring engine, never the sole decision-maker.

**Scale / cost?** The server is stateless apart from active groups: one small VPS handles thousands of concurrent
nights (a 250 ms tick per group). A check-in costs a fraction of a cent on Gemini Flash-Lite. Scale out by
sharding groups by join code; persistence isn't needed by design.

**Why not auto-call 911?** False positives would burden emergency services and erode trust. Friends first, then
bystanders, then family, and 911 is one tap away on every screen. Future: Text-to-911 / RapidSOS integration for
level 3.
