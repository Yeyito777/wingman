# Wingman protocol (v4)

The contract between the Wingman server and its clients: the native iPhone app (`mobile/`), the projector stage view
and the minimal web fallback. Types live in [`shared/protocol.ts`](../shared/protocol.ts) (plain TS, no runtime
imports; import it from Expo as-is). This document explains them. If the two disagree, the `.ts` file wins.

## Model: everyone is everyone's wingman

A **group** is a fully connected set of members. Every member is **guarded and a guardian**:

- every member's phone sends its own signals (location, motion, falls, heartbeat, app state, battery);
- each member has their **own** risk engine and escalation ladder on the server;
- when member X's risk reaches *alert*, **every other member** is alerted (L1). Any of them can tap **I'm on my way**
  (pauses X's ladder) or **Found & OK** (resolves it). X can cancel with their **PIN**, or by answering a check-in
  coherently;
- if nobody acknowledges: **bystander mode on X's phone** (L2: siren, "THIS PERSON MAY NEED HELP", medical info,
  Call 911, PIN to cancel), then **X's emergency contact** gets an SMS (L3, Twilio or simulated);
- several members can be in alert at once; each alert is independent.

"Distance from the group" for X = distance to the **nearest other member** with a fresh (<3 min), accurate (≤150 m)
fix, minus GPS uncertainty. If X is alone (no other fresh fixes), the venue (first good fix of the night) is used.

## Base URL, versions

- Base: whatever the app was configured with, e.g. `https://wingman.example` or the dev tunnel. All endpoints are
  under `/api`. JSON in, JSON out (`content-type: application/json`), errors are `{ "error": "..." }` with a 4xx/5xx.
- `PROTOCOL_VERSION` is in every `JoinResponse`, `GroupView` and WS `hello`. `GET /api/health` returns
  `{ ok, protocolVersion, scorer, notifier, push, groups }`.
- Times are **server** epoch milliseconds. For countdowns use `view.now` (offset = `view.now - Date.now()` at receipt).

## Auth

- Creating or joining returns `{ memberId, key }`. The **key is a per-member secret** (24 chars). Store both in
  SecureStore/Keychain; they are the login for tonight.
- REST: `Authorization: Bearer <key>` (also accepted: header `x-wingman-key: <key>`, or `?k=<key>`).
  The key identifies the caller. `:id` in a path is the **target** member. Endpoints marked *self* require
  `:id` = the caller.
- WebSocket: `/ws?g=<CODE>&m=<memberId>&k=<key>`.
- Stage/observer (demo only): `/ws?g=<CODE>&k=<stageKey>` (no `m`), read-everything view with `you: null`.
- Unknown/ended group → 404; bad key → 403; not yourself on a *self* endpoint → 403.

## Join codes and links

- 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L), e.g. `K7Q2XM`. Case-insensitive on input.
- `links.deepLink` = `wingman://join/K7Q2XM` (register the `wingman` scheme in the app).
- `links.joinUrl` = `<base>/j/K7Q2XM`: a tiny page that tries the deep link, shows the code big, and has a web
  fallback join link. Put it in the QR code. `parseJoinLink()` in `protocol.ts` extracts the code from either.

## Lifecycle

```
create group (member A)  ─►  share code / QR  ─►  B, C join  ─►  everyone opens WS + sends signals
       │                                                              │
       │      server: per member, every 250 ms: risk(signals) ─► escalation ladder ─► effects
       │                                                              │
       ▼                                                              ▼
 check-ins (server asks member over WS; member answers audio/text) · alerts fan out to all other members
       │
 leave (one member's data deleted)  ·  end night (any member; all data deleted)  ·  auto-expiry after 12 h
```

## REST endpoints

| Method + path | Auth | Body → Response |
|---|---|---|
| `GET /api/health` | – | → `{ ok, protocolVersion, scorer, notifier, push, groups }` |
| `POST /api/groups` | – | `CreateGroupRequest` → `JoinResponse` |
| `GET /api/groups/:code` | – | → `GroupPreview` (names + colours only) |
| `POST /api/groups/:code/join` | – | `MemberSetup` → `JoinResponse` |
| `GET /api/groups/:code/view` | member | → `GroupView` (same as WS `view`) |
| `POST /api/groups/:code/members/:id/signals` | self | `SignalBatch` → `{ ok, now }` |
| `POST /api/groups/:code/members/:id/checkins` | member | `AskCheckinRequest` → `{ ok, checkin }` (ask yourself, or "ping" a friend) |
| `POST /api/groups/:code/members/:id/checkins/:cid/answer` | self | `AnswerCheckinRequest` JSON, or raw `audio/*` body → `AnswerCheckinResponse` |
| `POST /api/groups/:code/members/:id/ack` | member ≠ :id | `{ kind?: "on_my_way" }` → `{ ok }` |
| `POST /api/groups/:code/members/:id/resolve` | member | self: `{ pin }` → `ResolveResponse` (401 wrong PIN, 423 locked). Other: `{ note? }` = "found & OK" |
| `POST /api/groups/:code/members/:id/escalate` | member | `{}` → `{ ok }` (push their ladder up one level now) |
| `POST /api/groups/:code/members/:id/push-token` | self | `PushTokenRequest` → `{ ok }` |
| `POST /api/groups/:code/members/:id/settings` | self | `MemberSettingsRequest` → `{ ok }` |
| `POST /api/groups/:code/members/:id/leave` | self | `{}` → `{ ok }` (your data is deleted, sockets get `left`) |
| `POST /api/groups/:code/end` | member | `{}` → `{ ok }` (everyone gets `ended`; all data deleted) |
| `GET /j/:code` | – | HTML: deep link + big code + web fallback |
| `POST /api/demo` | – | `CreateDemoRequest` → `CreateDemoResponse` (stage use) |
| `POST /api/groups/:code/demo/:action` | stage key, or member of a demo group | `DemoActionRequest` → `{ ok }` |

`MemberSetup` validation: `name` 1–30 chars, `pin` 4–8 digits, `consent: true` required (400 otherwise).

### Examples

Create:

```http
POST /api/groups
{ "groupName": "Friday at the Rex",
  "member": { "name": "Maya", "pin": "1234", "consent": true,
              "medical": "Penicillin allergy. Asthma (inhaler in bag).",
              "emergencyContact": { "name": "Mom", "phone": "+14165550199" }, "tzOffset": 240 } }

200 { "protocolVersion": 1, "code": "K7Q2XM", "memberId": "m_8d2kq", "key": "q7…(24)",
      "links": { "joinUrl": "https://host/j/K7Q2XM", "deepLink": "wingman://join/K7Q2XM" },
      "wsPath": "/ws?g=K7Q2XM&m=m_8d2kq&k=q7…", "view": { …GroupView } }
```

Join: `POST /api/groups/K7Q2XM/join` with a `MemberSetup` body → same `JoinResponse` shape.

Signals (every ~5 s in the foreground; any batch is also a heartbeat):

```http
POST /api/groups/K7Q2XM/members/m_8d2kq/signals
Authorization: Bearer q7…
{ "heartbeat": true, "battery": 0.62, "appState": "foreground",
  "fix": { "lat": 43.6487, "lng": -79.3962, "accuracy": 12 },
  "motion": { "moving": true, "activity": "walking", "peakG": 1.3, "windowMs": 5000 },
  "sensors": { "motion": "on", "location": "on", "mic": "on", "notifications": "on" } }
```

A fall (send once, after impact + stillness): `{ "fall": { "peakG": 3.4 } }`.
Going to the background: `{ "appState": "background" }` (or `"locked"`) **before** the app goes quiet.
The same payloads can go over the WebSocket as `{ "t": "signals", ... }`.

Check-in answer (iOS recording):

```http
POST /api/groups/K7Q2XM/members/m_8d2kq/checkins/c_x81/answer
{ "audio": "<base64 m4a>", "mime": "audio/m4a", "durationMs": 6400 }

200 { "ok": true, "checkin": { "id": "c_x81", "status": "done", "outcome": "impaired",
      "result": { "engine": "gemini", "model": "gemini-flash-lite-latest", "transcript": "uhh… m'fine…",
                  "responded": true, "coherent": false, "impairment": 0.82,
                  "signs": ["slurred speech", "disoriented"], "reason": "slurred speech, couldn't say where they are", … } } }
```

or typed: `{ "text": "At the Rex with Sam" }`. A raw body with `content-type: audio/m4a` also works.
409 if the check-in isn't pending any more (answered, missed or cleared).

Ack / found & OK / cancel:

```http
POST /api/groups/K7Q2XM/members/m_8d2kq/ack        (Sam's key)  {}                  → { "ok": true }
POST /api/groups/K7Q2XM/members/m_8d2kq/resolve    (Sam's key)  { "note": "with her" } → { "ok": true }
POST /api/groups/K7Q2XM/members/m_8d2kq/resolve    (Maya's key) { "pin": "1234" }    → { "ok": true }
                                                                                       | 401 { "ok": false, "attemptsLeft": 2 }
                                                                                       | 423 { "ok": false, "lockedUntil": … }
```

## WebSocket

`GET /ws?g=K7Q2XM&m=m_8d2kq&k=q7…` → upgrade. Server messages (`ServerMsg`):

| `t` | When | Client should |
|---|---|---|
| `hello` | on connect | replace local state with `view`; check `protocolVersion` |
| `view` | any visible change (full snapshot, at most a few per second) | re-render. **The view is the source of truth** |
| `alert` | a member's alert starts (stage 1) or climbs (2, 3) | `you=false`: alarm takeover + local notification with `title`/`body`. `you=true` & `alert.stage>=2`: **bystander mode** |
| `ack` | someone tapped "I'm on my way" | toast "Sam is on the way to Maya" |
| `resolved` | an alert ended | stop alarm / siren |
| `checkin` | the server asks **you** a check-in | chime + vibrate, speak `prompt` (TTS), record if `autoListen`, POST the answer before `deadline` |
| `member` | someone joined / left | toast |
| `ended` | night ended (by anyone, or 12 h expiry) | delete local group state, show "Night ended, data deleted" |
| `left` | you left from another device | same as ended, for you |
| `pong` | reply to `ping` | – |

Client messages (`ClientMsg`): `{ "t": "ping" }` (counts as heartbeat) and `{ "t": "signals", ...SignalBatch }`.
Everything else goes over REST so it gets a status code.

Presence: a member with an open WS (or a heartbeat in the last `heartbeatLostMs`) is `online`. After
`appState: background|locked` they are `background`, and silence is **not** alarming. If a foregrounded member stops
heartbeating for `heartbeatLostMs` they become `silent`, which feeds the dead-man's-switch risk reason.

## View model notes (privacy)

`GroupView.members[]` has one `MemberView` per member (you first). For **other** members, outside their alert:

- `phone` (their own number) is always visible to the group, so friends can call each other;
- `fix` / distances are `null` if they chose `shareLocation: "alert"`;
- `medical` is `""` and `emergencyContact.phone` is masked;
- `lastCheckin.result.transcript` is `""` (outcome + reason are visible).

During their alert (stage ≥ 1) everything is revealed to the group. You always see your own full data.
`MemberView.alert` is the member's `AlertState` (null at stage 0); `GroupView.alerts` lists all active ones.

## Check-in flow

1. Server decides (cadence `checkinEveryMs`, suspicion at risk ≥ 25, alert at ≥ 60, a friend's "ping", or manual)
   and sends `{ t: "checkin", checkin }` to that member's sockets (+ push if backgrounded and a token is set).
   `MemberView.checkin` shows it to everyone (status `pending`).
2. App speaks `checkin.prompt`, records up to ~10 s (iOS: `.m4a` AAC, 16–44.1 kHz mono is plenty). While recording
   or typing, it sends `{ answering: "<checkin id>" }` signals (every ~5 s): the deadline is held 50 s past the last
   one, so the answer in progress doesn't time out.
3. App POSTs the answer. Server sets status `scoring`, Gemini listens to the audio (fallback: OpenAI transcription,
   then an offline heuristic), status `done` with `outcome`:
   - `ok` → clears earlier signals; resolves an active alert;
   - `impaired` → adds risk (20–60 by impairment);
   - `missed` (deadline passed / nothing intelligible) → +35 (+60 for two in a row).

Audio formats: `audio/m4a`, `audio/x-m4a`, `audio/mp4`, `audio/aac`, `audio/wav`, `audio/webm`, `audio/ogg`,
`audio/mpeg`. The server normalises m4a variants to `audio/mp4` for Gemini. Verified Oct 17 against `gemini-flash-lite-latest` with a real ffmpeg-encoded AAC .m4a: `audio/m4a`, `audio/x-m4a`, `audio/mp4` and `audio/aac` all transcribe correctly.

## Push (optional)

`POST …/members/:id/push-token { kind: "expo", token: "ExponentPushToken[…]" }`. When a member is backgrounded and an
alert or check-in concerns them, the server sends a push if push is enabled (`engines.push` in the view: `"expo"` or
`"none"`). Default is `none`: the token is stored and nothing is sent. Sending uses the public Expo push API
(`EXPO_PUSH=1`); no other credentials.

## Demo (stage)

`POST /api/demo` makes a demo group with accelerated timers and simulated friends (Sam, Maya, Leo) that move and
heartbeat on the server. The presenter's phone joins with the code like a normal member. `POST
/api/groups/:code/demo/:action` with `{ target }` drives the storyline (`walk`, `fall`, `slurred`, `ack {by}`, …) for
either the real phone or a simulated friend; `subject {target}` sets the default subject, `mode {mode}` switches scripted
vs real-audio answers, `timers {timers}` overrides timers, `reset` clears every member's state (members stay
connected). The stage view is `/stage/:code?k=<stageKey>`. Simulated friends answer their own check-ins coherently
unless the storyline is driving them.

## CHANGELOG

- **v4** (Oct 18 2026): `SignalBatch.prompted` = a pending check-in's id once its question has finished playing on an
  open phone. The user then has 10 s to *start* answering (mic or first key → `answering`), else it's missed. Clients
  that never send it get ~25 s from the ask on an open phone; a backgrounded phone keeps `checkinTimeoutMs`.
  `Checkin.promptedAt`. A missed check-in now raises the alert (except a routine scheduled one on a real night); so
  does one impaired answer at ≥ 0.75. Scoring always ends within 15 s: if no engine can check a voice reply it is
  `outcome: "impaired"`, `result.model: "unscored"` ("answered, but Wingman couldn't check it"), never a silent OK.
  Additive.

- **v3** (Oct 18 2026): `SignalBatch.answering` = the pending check-in's id while the user is recording or typing a
  reply (send when the mic starts / the first key lands, then every ~5 s). Each one holds `Checkin.deadline` at least
  50 s past now, so an answer in progress never times out, while a phone that dies mid-answer still counts as missed
  ~50 s later. `Checkin.answeringAt` = the last such signal. Additive.

- **v2** (Oct 17 2026): `MemberView.phone` (the member's own number from `MemberSetup.phone`, `""` if not given),
  visible to every member of the group so the alert takeover can offer "Call Maya"; `MemberSettingsRequest.phone`.
  Additive; v1 clients keep working. (Also documented the demo-only `subject` / `mode` / `timers` actions.)
- **v1** (Oct 17 2026): first group protocol (symmetric members, join codes, per-member keys, WS hello/view/alert).
