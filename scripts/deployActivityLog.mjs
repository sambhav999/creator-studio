import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.join(__dirname, "..", "contracts");
const sourcePath = path.join(contractsDir, "KultActivityLog.sol");
const source = fs.readFileSync(sourcePath, "utf8");

// 1) Compile
const input = {
  language: "Solidity",
  sources: { "KultActivityLog.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === "error");
  output.errors.forEach((e) => console.log(e.formattedMessage));
  if (fatal.length) process.exit(1);
}
const artifact = output.contracts["KultActivityLog.sol"].KultActivityLog;
const abi = artifact.abi;
const bytecode = "0x" + artifact.evm.bytecode.object;
fs.writeFileSync(path.join(contractsDir, "KultActivityLog.abi.json"), JSON.stringify(abi, null, 2));
console.log("compiled OK — abi written to contracts/KultActivityLog.abi.json");

// 2) Deploy
const rpc = process.env.ZERO_G_STORAGE_EVM_RPC || process.env.ZERO_G_PAYMENT_RPC_URL || "https://evmrpc.0g.ai";
const key = process.env.ZERO_G_STORAGE_PRIVATE_KEY || process.env.ZERO_G_PRIVATE_KEY;
if (!key) { console.error("Missing ZERO_G_STORAGE_PRIVATE_KEY"); process.exit(1); }
const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(key, provider);
console.log("deployer:", wallet.address, "| balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "0G");

const factory = new ethers.ContractFactory(abi, bytecode, wallet);
console.log("deploying KultActivityLog to 0G…");
const contract = await factory.deploy();
const deployTx = contract.deploymentTransaction();
console.log("deploy tx:", deployTx?.hash);
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log("");
console.log("==================================================");
console.log("CONTRACT DEPLOYED");
console.log("address :", address);
console.log("owner   :", wallet.address);
console.log("deploy tx:", deployTx?.hash);
console.log("==================================================");
console.log("Add to .env:  ZERO_G_ACTIVITY_CONTRACT=" + address);
process.exit(0);
