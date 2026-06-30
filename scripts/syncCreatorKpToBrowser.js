import "dotenv/config";
import { getDatabaseByName, getMongoClient } from "../src/services/databaseService.js";

const POINTS_DB = "kult_browser";
const LEDGER_COLLECTION = "kp_ledger";
const BROWSER_BALANCES_COLLECTION = "kult_points";
const BATCH_SIZE = 500;

function normalizeUserId(userId) {
  const value = String(userId || "").trim();
  return /^0x/i.test(value) ? value.toLowerCase() : value;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getDatabaseByName(POINTS_DB);
  const ledger = db.collection(LEDGER_COLLECTION);
  const browserBalances = db.collection(BROWSER_BALANCES_COLLECTION);
  const now = new Date();

  let processed = 0;
  let synced = 0;
  let skipped = 0;

  while (true) {
    const events = await ledger
      .find({
        source: "creator-studio",
        browserBalanceSyncedAt: { $exists: false },
        points: { $gt: 0 },
      }, {
        projection: { eventId: 1, userId: 1, points: 1, createdAt: 1 },
        limit: BATCH_SIZE,
      })
      .toArray();

    if (!events.length) break;

    for (const event of events) {
      processed += 1;
      const walletAddress = normalizeUserId(event.userId);
      const points = Number(event.points);

      if (!walletAddress || !Number.isFinite(points) || points <= 0) {
        skipped += 1;
        if (!dryRun) {
          await ledger.updateOne(
            { _id: event._id },
            { $set: { browserBalanceSyncSkippedAt: now, browserBalanceSyncSkipReason: "invalid-event" } },
          );
        }
        continue;
      }

      if (!dryRun) {
        await browserBalances.updateOne(
          { walletAddress },
          {
            $inc: { kultPoints: points },
            $set: { walletAddress, updatedAt: now },
            $setOnInsert: { createdAt: event.createdAt ?? now },
          },
          { upsert: true },
        );
        await ledger.updateOne(
          { _id: event._id },
          { $set: { browserBalanceSyncedAt: now } },
        );
      }
      synced += 1;
    }

    if (dryRun) break;
  }

  console.log(JSON.stringify({
    dryRun,
    database: POINTS_DB,
    ledgerCollection: LEDGER_COLLECTION,
    browserBalancesCollection: BROWSER_BALANCES_COLLECTION,
    processed,
    synced,
    skipped,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const client = await getMongoClient().catch(() => null);
    await client?.close();
  });
