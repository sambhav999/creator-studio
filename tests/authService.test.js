import test from "node:test";
import assert from "node:assert/strict";
import {
  derivePrivyUserId,
  extractPrivyIdentity,
  getPrivyAuthConfig,
  verifyPrivySession
} from "../src/services/authService.js";

test("derivePrivyUserId uses Privy id as the canonical cross-app identity", () => {
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

  assert.equal(userId, "did:privy:user");
});

test("extractPrivyIdentity keeps wallets and Telegram as aliases", () => {
  const identity = extractPrivyIdentity({
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

  assert.equal(identity.userId, "did:privy:user");
  assert.equal(identity.evmWalletAddress, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  assert.equal(identity.tonWalletAddress, "EQBtonWalletAddress");
  assert.equal(identity.telegramUserId, "12345");
  assert.deepEqual(identity.identityAliases, [
    "did:privy:user",
    "EQBtonWalletAddress",
    "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "tg_12345"
  ]);
});

test("derivePrivyUserId falls back to wallet, Telegram, and access token ids", () => {
  assert.equal(
    derivePrivyUserId({
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
      linked_accounts: [
        {
          type: "telegram",
          telegram_user_id: "12345"
        }
      ]
    }),
    "tg_12345"
  );

  assert.equal(derivePrivyUserId({ id: "did:privy:user" }, "did:from-access-token"), "did:privy:user");
  assert.equal(derivePrivyUserId(null, "did:from-access-token"), "did:from-access-token");
});

test("verifyPrivySession rejects requests without Privy credentials", async () => {
  await assert.rejects(
    () => verifyPrivySession({}),
    (error) => error.status === 401 && error.message === "Privy authentication required"
  );
});

test("Privy verification keys support escaped deployment line breaks", () => {
  const originalKey = process.env.PRIVY_VERIFICATION_KEY;
  process.env.PRIVY_VERIFICATION_KEY =
    "-----BEGIN PUBLIC KEY-----\\npublic-key-data\\n-----END PUBLIC KEY-----";

  try {
    assert.equal(
      getPrivyAuthConfig().verificationKey,
      "-----BEGIN PUBLIC KEY-----\npublic-key-data\n-----END PUBLIC KEY-----"
    );
  } finally {
    if (originalKey === undefined) delete process.env.PRIVY_VERIFICATION_KEY;
    else process.env.PRIVY_VERIFICATION_KEY = originalKey;
  }
});

test("verifyPrivySession rejects missing Privy server configuration", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppId = process.env.PRIVY_APP_ID;
  const originalVerificationKey = process.env.PRIVY_VERIFICATION_KEY;

  delete process.env.PRIVY_APP_ID;
  delete process.env.PRIVY_VERIFICATION_KEY;
  process.env.NODE_ENV = "development";

  try {
    await assert.rejects(
      () => verifyPrivySession({ accessToken: "dev-token" }),
      (error) => error.status === 500 && error.message === "Privy auth is not configured"
    );
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAppId === undefined) delete process.env.PRIVY_APP_ID;
    else process.env.PRIVY_APP_ID = originalAppId;
    if (originalVerificationKey === undefined) delete process.env.PRIVY_VERIFICATION_KEY;
    else process.env.PRIVY_VERIFICATION_KEY = originalVerificationKey;
  }
});
