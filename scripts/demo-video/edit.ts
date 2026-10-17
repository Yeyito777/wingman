// Cuts the recorded take into the final demo video: pads to 1080p, lays the narration lines and the slurred check-in
// clip at the take's marks, normalises loudness, encodes H.264 + AAC.
//   bun scripts/demo-video/edit.ts TAKE_DIR TTS_DIR OUT.mp4

import { spawnSync } from "node:child_process";

const [TAKE, TTS, OUT] = process.argv.slice(2);
if (!TAKE || !TTS || !OUT) throw new Error("usage: edit.ts TAKE_DIR TTS_DIR OUT.mp4");
const m: Record<string, number> = await Bun.file(`${TAKE}/marks.json`).json();
const dur = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).stdout.toString());
const SLURRED = new URL("../../public/demo-audio/slurred.wav", import.meta.url).pathname;

const start = m["card-open"]! + 0.1;
const clips: { file: string; at: number }[] = [];
let prevEnd = 0;
const place = (name: string, at: number) => {
  const file = `${TTS}/${name}.wav`;
  const t = Math.max(at, prevEnd + 0.3);
  clips.push({ file, at: t });
  prevEnd = t + dur(file);
  console.log(`${name} @ ${(t - start).toFixed(1)} s (${dur(file).toFixed(1)} s)`);
};
place("n0", m["card-open"]! + 0.7);
place("n1", m["group"]! + 0.4);
place("n2", m["checkin"]! + 0.3);
place("n3", m["walk"]! + 0.5);
place("n4", m["ask-again"]! + 0.2);
clips.push({ file: SLURRED, at: m["slurred"]! + 0.1 });
place("n5", m["alert"]! + 0.3);
place("n6", m["bystander"]! + 0.5);
place("n7", m["l3"]! + 1.0);
place("n8", m["resolved"]! + 0.5);
const end = Math.min(m["end"]!, prevEnd + 3);
const len = end - start;

const args = ["-y", "-v", "error", "-ss", String(start), "-t", String(len), "-i", `${TAKE}/take.mkv`];
for (const c of clips) args.push("-i", c.file);
const delays = clips.map((c, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round((c.at - start) * 1000)}:all=1${c.file === SLURRED ? ",volume=1.1" : ""}[a${i}]`);
const filter = [
  `[0:v]pad=1920:1080:1:11:color=0x0b0e17,fps=30,fade=t=in:st=0:d=0.6,fade=t=out:st=${(len - 1.5).toFixed(2)}:d=1.5,format=yuv420p[v]`,
  ...delays,
  `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad,atrim=0:${len.toFixed(2)},afade=t=out:st=${(len - 1.5).toFixed(2)}:d=1.5[a]`,
].join(";");
args.push("-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT);
const r = spawnSync("ffmpeg", args, { stdio: "inherit" });
if (r.status !== 0) throw new Error("ffmpeg failed");
console.log(`${OUT}: ${len.toFixed(1)} s`);
