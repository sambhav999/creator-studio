require("@nomicfoundation/hardhat-toolbox");
const dotenv = require("dotenv");

dotenv.config({ path: "../.env" });
dotenv.config();

const privateKey =
  process.env.ZERO_G_ACTIVITY_PRIVATE_KEY
  || process.env.CONTRACT_DEPLOYER_PRIVATE_KEY
  || process.env.CONTRACT_DEPLOYER_ADDRESS
  || "";

function accounts() {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(privateKey.trim())
    ? [privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`]
    : [];
}

const zeroGMainnetRpc = process.env.ZERO_G_ACTIVITY_RPC_URL
  || process.env.ZERO_G_MAINNET_RPC_URL
  || "https://evmrpc.0g.ai";
const zeroGTestnetRpc = process.env.ZERO_G_ACTIVITY_TESTNET_RPC_URL
  || process.env.ZERO_G_STORAGE_EVM_RPC
  || "https://evmrpc-testnet.0g.ai";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    zeroGMainnet: {
      url: zeroGMainnetRpc,
      chainId: Number(process.env.ZERO_G_ACTIVITY_CHAIN_ID || process.env.ZERO_G_MAINNET_CHAIN_ID || 16661),
      accounts: accounts()
    },
    zeroGTestnet: {
      url: zeroGTestnetRpc,
      chainId: Number(process.env.ZERO_G_ACTIVITY_TESTNET_CHAIN_ID || 16602),
      accounts: accounts()
    }
  },
  etherscan: {
    apiKey: {
      zeroGMainnet: process.env.ZERO_G_EXPLORER_API_KEY || "0g",
      zeroGTestnet: process.env.ZERO_G_EXPLORER_API_KEY || "0g"
    },
    customChains: [
      {
        network: "zeroGMainnet",
        chainId: 16661,
        urls: {
          apiURL: process.env.ZERO_G_MAINNET_VERIFY_API_URL || "https://chainscan.0g.ai/api",
          browserURL: "https://chainscan.0g.ai"
        }
      },
      {
        network: "zeroGTestnet",
        chainId: 16602,
        urls: {
          apiURL: process.env.ZERO_G_TESTNET_VERIFY_API_URL || "https://chainscan-galileo.0g.ai/api",
          browserURL: "https://chainscan-galileo.0g.ai"
        }
      }
    ]
  },
  sourcify: {
    enabled: true
  }
};
