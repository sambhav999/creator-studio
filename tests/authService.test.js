import test from "node:test";
import assert from "node:assert/strict";
import { derivePrivyUserId, verifyPrivySession } from "../src/services/authService.js";

test("derivePrivyUserId prefers TON wallets over other linked identities", () => {
  const userId = derivePrivyUserId({
    id: "did:privy:user",
    linked_accounts: [
      {
        type: "telegram",
        telegram_user_id: "12345"
      },
      {
        type: "wallet",
        chain_type: "ethereum",
        address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD"
      },
      {
        type: "wallet",
        chain_type: "ton",
        address: "EQBtonWalletAddress"
      }
    ]
  });

  assert.equal(userId, "EQBtonWalletAddress");
});

test("derivePrivyUserId falls back to wallet, Telegram, and Privy ids", () => {
  assert.equal(
    derivePrivyUserId({
      id: "did:privy:user",
      linkedAccounts: [
        {
          type: "wallet",
          chainType: "ethereum",
          address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD"
        }
      ]
    }),
    "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
  );

  assert.equal(
    derivePrivyUserId({
      id: "did:privy:user",
      linked_accounts: [
        {
          type: "telegram",
          telegram_user_id: "12345"
        }
      ]
    }),
    "tg_12345"
  );

  assert.equal(derivePrivyUserId({ id: "did:privy:user" }, "did:from-access-token"), "did:from-access-token");
});

test("verifyPrivySession is additive for non-Privy clients", async () => {
  const session = await verifyPrivySession({});
  assert.equal(session, null);
});

test("verifyPrivySession allows local fallback when Privy env is missing", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppId = process.env.PRIVY_APP_ID;
  const originalVerificationKey = process.env.PRIVY_VERIFICATION_KEY;

  delete process.env.PRIVY_APP_ID;
  delete process.env.PRIVY_VERIFICATION_KEY;
  process.env.NODE_ENV = "development";

  try {
    const session = await verifyPrivySession({ accessToken: "dev-token" });
    assert.equal(session, null);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAppId === undefined) delete process.env.PRIVY_APP_ID;
    else process.env.PRIVY_APP_ID = originalAppId;
    if (originalVerificationKey === undefined) delete process.env.PRIVY_VERIFICATION_KEY;
    else process.env.PRIVY_VERIFICATION_KEY = originalVerificationKey;
  }
});
