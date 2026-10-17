import { startServer } from "./app.ts";

const app = startServer();
const info = await (await fetch(`${app.url}/api/health`)).json();
console.log(`\n  Wingman is running on ${app.url}`);
console.log(`  AI check-ins: ${info.scorer}   ·   Level-3 notifier: ${info.notifier}`);
console.log(`  Phones need HTTPS for motion, location and microphone: run \`bun run tunnel\` in another terminal.\n`);
