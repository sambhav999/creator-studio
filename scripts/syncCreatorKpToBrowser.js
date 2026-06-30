import "dotenv/config";
import { getMongoClient } from "../src/services/databaseService.js";
import { syncCreatorKpToBrowserBalances } from "../src/services/pointsService.js";

async function main() {
  const result = await syncCreatorKpToBrowserBalances({
    dryRun: process.argv.includes("--dry-run"),
  });
  console.log(JSON.stringify(result, null, 2));
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
