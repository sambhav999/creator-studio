import test from "node:test";
import assert from "node:assert/strict";
import { getAddress, Wallet } from "ethers";
import {
  createWalletLinkChallenge,
  verifyWalletLinkSignature,
} from "../src/services/walletLinkService.js";

test("wallet link challenge verifies a 0G-chain signature", async () => {
  const wallet = Wallet.createRandom();
  const { message, address } = createWalletLinkChallenge({
    privyUserId: "did:privy:test",
    address: wallet.address,
  });
  const signature = await wallet.signMessage(message);
  const linked = verifyWalletLinkSignature({
    message,
    signature,
    address,
    privyUserId: "did:privy:test",
  });
  assert.equal(linked, getAddress(wallet.address));
});

test("wallet link challenge rejects a mismatched signer", async () => {
  const wallet = Wallet.createRandom();
  const other = Wallet.createRandom();
  const { message, address } = createWalletLinkChallenge({
    privyUserId: "did:privy:test",
    address: wallet.address,
  });
  const signature = await other.signMessage(message);
  assert.throws(
    () =>
      verifyWalletLinkSignature({
        message,
        signature,
        address,
        privyUserId: "did:privy:test",
      }),
    (error) => error.status === 400,
  );
});
