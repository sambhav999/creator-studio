const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured. Set ZERO_G_ACTIVITY_PRIVATE_KEY in creator-studio/.env.");
  }

  const owner = process.env.ZERO_G_ACTIVITY_OWNER || deployer.address;
  console.log(`Deploying CreatorActivityRegistry to ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Owner: ${owner}`);

  const Registry = await ethers.getContractFactory("CreatorActivityRegistry");
  const registry = await Registry.deploy(owner);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const deployment = await registry.deploymentTransaction()?.wait();
  const output = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    contract: "CreatorActivityRegistry",
    address,
    owner,
    deployer: deployer.address,
    transactionHash: deployment?.hash ?? registry.deploymentTransaction()?.hash ?? null,
    blockNumber: deployment?.blockNumber ?? null,
    deployedAt: new Date().toISOString()
  };

  const deploymentsDir = path.resolve("deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(deploymentsDir, `${network.name}.json`), `${JSON.stringify(output, null, 2)}\n`);

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
