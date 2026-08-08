/**
 * Proves the score store is durable — by using it, not by reading configuration.
 *
 * Step 3 of the launch sequence gates on "/stats reports Durable". That report is only worth
 * anything if it reflects a real round-trip: two non-empty environment variables are enough to make
 * the app take the Redis branch, so a typo'd URL or a revoked token reads as durable right up until
 * the first player's score is silently lost. This script writes a key, reads it back, checks the
 * TTL landed, and deletes it. A pass means scores written by one serverless instance can be read by
 * another, which is the only property that matters at settlement time.
 *
 *   npm run check:store
 *
 * Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the environment, then .env.local
 * (what `vercel env pull` writes), then .env.
 */
import { readFileSync } from "node:fs";

function readEnvFile(name) {
  try {
    return Object.fromEntries(
      readFileSync(new URL(`../${name}`, import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          // `vercel env pull` quotes its values; the app's own .env does not.
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"(.*)"$/s, "$1")];
        }),
    );
  } catch {
    return {};
  }
}

const files = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const value = (key) => process.env[key] || files[key] || "";

// Mirrors lib/server/store.ts: Upstash's console gives UPSTASH_REDIS_REST_*, the Vercel
// Marketplace integration gives KV_REST_API_* for the same database.
const URL_ = value("UPSTASH_REDIS_REST_URL") || value("KV_REST_API_URL");
const TOKEN = value("UPSTASH_REDIS_REST_TOKEN") || value("KV_REST_API_TOKEN");

const missing = [
  URL_ ? null : "UPSTASH_REDIS_REST_URL (or KV_REST_API_URL)",
  TOKEN ? null : "UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN)",
].filter(Boolean);
if (missing.length > 0) {
  console.error(`✗ ${missing.join(" and ")} not set.`);
  console.error("  The score store is an in-memory map: it does not survive a restart and is not");
  console.error("  shared between serverless instances. Provision Upstash before production:");
  console.error("    vercel integration add upstash/upstash-kv");
  console.error("    vercel env pull .env.local");
  process.exit(1);
}

/** One command over the Upstash REST API — the same call shape lib/server/store.ts makes. */
async function redis(command) {
  const response = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} — ${(await response.text()).slice(0, 200)}`);
  }
  return (await response.json()).result;
}

const key = `clash:probe:${Date.now()}`;
const written = { probe: true, at: new Date().toISOString() };

try {
  const pong = await redis(["PING"]);
  if (pong !== "PONG") throw new Error(`PING answered ${JSON.stringify(pong)}, expected PONG.`);

  await redis(["SET", key, JSON.stringify(written), "EX", 60]);

  const readBack = await redis(["GET", key]);
  if (readBack === null) throw new Error("the key was written but read back as missing.");
  if (JSON.parse(readBack).at !== written.at) throw new Error("the value read back is not the value written.");

  // The store leans on EXPIRE so scores do not accumulate forever. If TTLs are not honoured, that
  // assumption is wrong and worth knowing here rather than discovering as unbounded growth.
  const ttl = await redis(["TTL", key]);
  if (typeof ttl !== "number" || ttl <= 0) throw new Error(`TTL came back as ${JSON.stringify(ttl)}.`);

  await redis(["DEL", key]);
  if ((await redis(["GET", key])) !== null) throw new Error("the probe key survived DEL.");

  console.log(`✓ Score store is durable — write, read, ${ttl}s TTL and delete all confirmed.`);
  console.log(`  ${new URL(URL_).host}`);
  console.log("  /stats will report the score store as Durable.");
} catch (error) {
  console.error(`✗ Redis is configured but not usable: ${error.message}`);
  console.error("  /stats will report 'Configured but unreachable'. Scores are not being saved.");
  console.error("  Check the URL and token, then re-run.");
  process.exit(1);
}
