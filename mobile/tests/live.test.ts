// Runs the app's API client against a real server: WINGMAN_URL=http://localhost:3100 bun test tests/live.test.ts
import { expect, test } from "bun:test";
import type { GroupView, ServerMsg } from "@shared/protocol";
import { WingmanClient } from "../src/api/client";

const URL = process.env.WINGMAN_URL;
const setup = (name: string) => ({ name, pin: "1234", consent: true, phone: "+14165550100", medical: "Asthma", emergencyContact: { name: "Mom", phone: "+14165550199" } });

test.skipIf(!URL)("two phones: create, join, live views, fall + ack + PIN cancel, end", async () => {
  const anon = new WingmanClient(URL!);
  const a = await anon.createGroup({ member: setup("Ana") });
  expect(a.code).toHaveLength(6);
  const preview = await anon.preview(a.code);
  expect(preview.members.map((m) => m.name)).toEqual(["Ana"]);
  const b = await anon.join(a.code, setup("Ben"));
  const ca = anon.withCreds({ code: a.code, memberId: a.memberId, key: a.key });
  const cb = anon.withCreds({ code: b.code, memberId: b.memberId, key: b.key });

  const views: GroupView[] = [];
  const msgs: ServerMsg[] = [];
  const live = cb.connect({ onStatus: () => {}, onMessage: (m) => { msgs.push(m); if (m.t === "view" || m.t === "hello") views.push(m.view); } });
  const until = async (f: () => boolean, ms = 15_000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await Bun.sleep(100); } };
  await until(() => views.length > 0);
  const last = () => views[views.length - 1]!;
  expect(last().members.find((m) => m.isYou)?.name).toBe("Ben");
  expect(last().members.find((m) => !m.isYou)?.phone).toBe("+14165550100");

  await ca.signals({ heartbeat: true, fix: { lat: 43.6487, lng: -79.3962, accuracy: 10 } });
  await cb.signals({ heartbeat: true, fix: { lat: 43.6488, lng: -79.3961, accuracy: 10 } });
  await ca.escalate(a.memberId); // stand-in for the risk engine tripping
  await until(() => last().alerts.some((x) => x.memberId === a.memberId));
  expect(msgs.some((m) => m.t === "alert" && !m.you)).toBe(true);
  await cb.ack(a.memberId);
  await until(() => !!last().alerts.find((x) => x.memberId === a.memberId)?.acks.some((k) => k.by === b.memberId));
  const wrong = await ca.resolve(a.memberId, "0000").catch((e) => e);
  expect(wrong.status).toBe(401);
  await ca.resolve(a.memberId, "1234");
  await until(() => !last().alerts.some((x) => x.memberId === a.memberId));

  const asked = await cb.askCheckin(b.memberId);
  expect(asked.checkin?.status).toBe("pending");
  const ans = await cb.answerCheckin(asked.checkin!.id, { text: "I'm at the Rex on Queen Street with Ana, heading home soon." });
  expect(ans.checkin?.status).toBe("done");

  await ca.endNight();
  await until(() => msgs.some((m) => m.t === "ended"));
  live.close();
}, 60_000);
