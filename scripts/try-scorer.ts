// Manual smoke test for the check-in scorer: bun scripts/try-scorer.ts "reply text" [path/to/audio.wav]
import { scoreCheckin, availableEngines } from "../src/server/scorer.ts";
const [text, audioPath] = process.argv.slice(2);
const audio = audioPath ? { data: new Uint8Array(await Bun.file(audioPath).arrayBuffer()), mime: "audio/wav" } : undefined;
console.log("engines:", availableEngines().join(" -> "));
const r = await scoreCheckin({ question: "Quick check-in: where are you right now, and who are you with?", name: "Yeyito", text: audio ? undefined : text, audio });
console.log(JSON.stringify(r, null, 2));
