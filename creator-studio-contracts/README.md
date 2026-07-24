# Creator Studio 0G Contracts

This package deploys the `CreatorActivityRegistry` contract used by the backend
to record compact on-chain proofs for creator activity.

## Environment

The scripts load the backend `../.env` first, then local `.env`.

Required:

```bash
ZERO_G_ACTIVITY_PRIVATE_KEY=
ZERO_G_ACTIVITY_RPC_URL=https://evmrpc.0g.ai
ZERO_G_ACTIVITY_CHAIN_ID=16661
```

`CONTRACT_DEPLOYER_ADDRESS` is supported as a legacy fallback if it contains a
private key, but `ZERO_G_ACTIVITY_PRIVATE_KEY` is preferred.

After deploy, set this in the backend `.env`:

```bash
ZERO_G_ACTIVITY_CONTRACT_ADDRESS=<deployed-address>
```

## Commands

```bash
npm install
npm run compile
npm test
npm run deploy:0g
npm run verify:0g
```

0G mainnet uses chain id `16661`, RPC `https://evmrpc.0g.ai`, and explorer
`https://chainscan.0g.ai`. The project compiles with Solidity `0.8.24` and
`evmVersion: "cancun"`.
