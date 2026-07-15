import { Address, TonClient, toNano } from "@ton/ton";
import { getDatabase } from "./databaseService.js";

const PAYMENTS_COLLECTION = process.env.TON_PAYMENTS_COLLECTION || "ton_generation_payments";
const DEFAULT_TON_ENDPOINT = "https://toncenter.com/api/v2/jsonRPC";

function getTonPaymentConfig() {
  return {
    endpoint: process.env.TON_RPC_URL || DEFAULT_TON_ENDPOINT,
    apiKey: process.env.TON_API_KEY || undefined,
    treasuryWallet: process.env.TON_TREASURY_WALLET || "",
    confirmations: Number(process.env.TON_PAYMENT_CONFIRMATIONS || 1),
    lookupLimit: Number(process.env.TON_PAYMENT_LOOKUP_LIMIT || 40),
    verifyAttempts: Number(process.env.TON_PAYMENT_VERIFY_ATTEMPTS || 8),
    verifyDelayMs: Number(process.env.TON_PAYMENT_VERIFY_DELAY_MS || 3000),
  };
}

function normalizeTonAddress(address, name) {
  try {
    return Address.parse(String(address ?? "")).toRawString();
  } catch {
    const error = new Error(`${name} must be a valid TON address`);
    error.status = 500;
    throw error;
  }
}

function normalizeReference(reference) {
  const value = String(reference ?? "").trim();
  if (!/^[a-fA-F0-9]{24}$/.test(value)) {
    const error = new Error("A valid TON payment reference is required");
    error.status = 400;
    throw error;
  }
  return value.toLowerCase();
}

function incomingComment(message) {
  if (typeof message?.message === "string" && message.message) return message.message;
  const msgData = message?.msg_data;
  if (
    msgData?.["@type"] === "msg.dataText"
    || msgData?.["@type"] === "msg.dataDecryptedText"
    || msgData?.["@type"] === "msg.dataEncryptedText"
  ) {
    return msgData.text;
  }
  return "";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paymentCollection() {
  const database = await getDatabase();
  const collection = database.collection(PAYMENTS_COLLECTION);
  await collection.createIndex({ reference: 1 }, { unique: true, name: "ton_payment_reference_unique" });
  await collection.createIndex({ txHash: 1 }, { unique: true, name: "ton_payment_txHash_unique" });
  return collection;
}

async function findIncomingPayment({ client, treasury, payer, requiredAmount, reference, limit }) {
  const transactions = await client.getTransactions(Address.parse(treasury), { limit });
  const expectedComment = `kult-generation:${reference}`;
  return transactions.find((transaction) => {
    const message = transaction.in_msg;
    if (!message?.source || !message?.destination) return false;
    if (normalizeTonAddress(message.source, "TON payment sender") !== payer) return false;
    if (normalizeTonAddress(message.destination, "TON payment recipient") !== treasury) return false;
    if (BigInt(message.value || "0") < requiredAmount) return false;
    return incomingComment(message).trim() === expectedComment;
  });
}

export async function verifyAndRecordTonGenerationPayment({ reference, creatorId, amountTon }) {
  const normalizedReference = normalizeReference(reference);
  const payer = normalizeTonAddress(creatorId, "Authenticated TON wallet");
  const config = getTonPaymentConfig();
  const treasury = normalizeTonAddress(config.treasuryWallet, "TON_TREASURY_WALLET");
  const requiredAmount = toNano(String(amountTon));
  const collection = await paymentCollection();
  const existing = await collection.findOne({ reference: normalizedReference });
  if (existing) {
    const conflict = new Error("This TON payment reference has already been used");
    conflict.status = 409;
    conflict.code = "PAYMENT_ALREADY_USED";
    throw conflict;
  }

  const client = new TonClient({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    timeout: 15000,
  });

  let transaction = null;
  const attempts = Number.isFinite(config.verifyAttempts) && config.verifyAttempts > 0 ? config.verifyAttempts : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    transaction = await findIncomingPayment({
      client,
      treasury,
      payer,
      requiredAmount,
      reference: normalizedReference,
      limit: config.lookupLimit,
    });
    if (transaction) break;
    if (attempt < attempts) await delay(config.verifyDelayMs);
  }

  if (!transaction) {
    const error = new Error("TON payment was not found on-chain yet");
    error.status = 402;
    error.code = "PAYMENT_NOT_CONFIRMED";
    throw error;
  }

  const txHash = String(transaction.transaction_id?.hash ?? "");
  try {
    await collection.insertOne({
      reference: normalizedReference,
      txHash,
      payer,
      treasury,
      amountNano: String(transaction.in_msg.value),
      requiredAmountNano: requiredAmount.toString(),
      logicalTime: transaction.transaction_id?.lt,
      createdAt: new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const conflict = new Error("This TON payment has already been used");
      conflict.status = 409;
      conflict.code = "PAYMENT_ALREADY_USED";
      throw conflict;
    }
    throw error;
  }

  return {
    reference: normalizedReference,
    txHash,
    payer,
    treasury,
    amountNano: String(transaction.in_msg.value),
    logicalTime: transaction.transaction_id?.lt,
    chain: "ton-mainnet",
  };
}
