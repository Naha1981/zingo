import { copyFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
mkdirSync("dist/_worker.js", { recursive: true });
copyFileSync("cloudflare/worker.js", "dist/_worker.js/index.js");
copyFileSync("cloudflare/payment-test.js", "dist/_worker.js/payment-test.js");
writeFileSync(
  "dist/_routes.json",
  JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }),
);
