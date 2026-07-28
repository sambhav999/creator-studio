import test from "node:test";
import assert from "node:assert/strict";
import {
  derivePrivyUserId,
  enrichAuthPayload,
  extractPrivyIdentity,
  getPrivyAuthConfig,
  signToken,
  verifyPrivySession,
  verifyToken
} from "../src/services/authService.js";

test("derivePrivyUserId uses the verified EVM wallet as the canonical identity", () => {
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

  assert.equal(userId, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
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

  assert.equal(identity.userId, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
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

test("extractPrivyIdentity treats 0x wallets without chain_type as EVM", () => {
  const identity = extractPrivyIdentity({
    id: "did:privy:user",
    linked_accounts: [
      {
        type: "wallet",
        address: "0x5e95aa80893ee0fddfbcd051c042ed8f9814568e"
      }
    ]
  });

  assert.equal(identity.userId, "0x5e95aa80893ee0fddfbcd051c042ed8f9814568e");
  assert.equal(identity.evmWalletAddress, "0x5e95aa80893ee0fddfbcd051c042ed8f9814568e");
});

test("enrichAuthPayload backfills evmWalletAddress from userId", () => {
  const enriched = enrichAuthPayload({
    userId: "0x5e95aa80893ee0fddfbcd051c042ed8f9814568e",
    evmWalletAddress: null
  });

  assert.equal(enriched.evmWalletAddress, "0x5e95aa80893ee0fddfbcd051c042ed8f9814568e");
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

test("Privy verification keys support a base64 SPKI body from the dashboard", () => {
  const originalKey = process.env.PRIVY_VERIFICATION_KEY;
  process.env.PRIVY_VERIFICATION_KEY = '"YWJjZA=="';

  try {
    assert.equal(
      getPrivyAuthConfig().verificationKey,
      "-----BEGIN PUBLIC KEY-----\nYWJjZA==\n-----END PUBLIC KEY-----"
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

test("signToken can re-issue a wallet-linked JWT from a verified token payload", () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-sign-token-secret";

  try {
    const first = signToken({
      userId: "did:privy:user",
      privyUserId: "did:privy:user",
      evmWalletAddress: null,
      identityAliases: ["did:privy:user"]
    });
    const verified = verifyToken(first);
    const second = signToken({
      ...verified,
      userId: "0x5e95aa80893ee0fddfbcd051c042ed8f9814568e",
      evmWalletAddress: "0x5e95aa80893ee0fddfbcd051c042ed8f9814568e",
      identityAliases: ["did:privy:user", "0x5e95aa80893ee0fddfbcd051c042ed8f9814568e"]
    });

    assert.equal(typeof second, "string");
    assert.match(second, /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
    assert.equal(
      verifyToken(second).evmWalletAddress,
      "0x5e95aa80893ee0fddfbcd051c042ed8f9814568e"
    );
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
