const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { network } = hre;

async function main() {
  const deploymentPath = path.resolve("deployments", `${network.name}.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  console.log(`Verifying ${deployment.contract} at ${deployment.address} on ${network.name}`);
  try {
    await hre.run("verify:verify", {
      address: deployment.address,
      constructorArguments: [deployment.owner],
      contract: "contracts/CreatorActivityRegistry.sol:CreatorActivityRegistry"
    });
    console.log("Verification submitted successfully.");
  } catch (error) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Contract is already verified.");
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
