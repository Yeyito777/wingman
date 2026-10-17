import { expect, test } from "bun:test";
import { createFallDetector } from "../src/lib/fall";

function run(trace: [number, number][], confirmMs = 3000) {
  const d = createFallDetector({ confirmMs });
  const out = [];
  for (const [t, g] of trace) out.push(...d.push(0, 0, g, t));
  return out.filter((e) => e.kind === "fall");
}

const series = (from: number, to: number, g: number, step = 50): [number, number][] => {
  const out: [number, number][] = [];
  for (let t = from; t < to; t += step) out.push([t, g]);
  return out;
};

test("impact then stillness is a fall", () => {
  const falls = run([...series(0, 1000, 1), [1000, 3.4], [1050, 2.8], ...series(1100, 5500, 1.02)]);
  expect(falls.length).toBe(1);
  expect(falls[0]).toMatchObject({ kind: "fall", peakG: 3.4 });
});

test("impact followed by movement is not a fall (e.g. a jump while dancing)", () => {
  const falls = run([...series(0, 1000, 1), [1000, 3.1], ...series(1100, 2500, 1.02), ...series(2500, 6000, 1.6, 100)]);
  expect(falls.length).toBe(0);
});

test("ordinary movement never triggers", () => {
  const trace = series(0, 20_000, 1).map(([t]) => [t, 1 + 0.6 * Math.sin(t / 150)] as [number, number]);
  expect(run(trace).length).toBe(0);
});

test("stillness without an impact is not a fall", () => {
  expect(run(series(0, 30_000, 1)).length).toBe(0);
});
