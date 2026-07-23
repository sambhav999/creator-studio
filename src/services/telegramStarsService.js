import { nanoid } from "nanoid";
import { getDatabase, getGamePackageById, updateGamePackageFields } from "./databaseService.js";
import { authOwnsIdentity } from "./identityAliasService.js";
import { logActivity } from "./activityService.js";

const ORDERS_COLLECTION = process.env.TELEGRAM_STARS_ORDERS_COLLECTION || "telegram_star_orders";
const EVENTS_COLLECTION = process.env.TELEGRAM_PAYMENT_EVENTS_COLLECTION || "telegram_payment_events";
const BOOSTS_COLLECTION = process.env.GAME_BOOSTS_COLLECTION || "game_boosts";
const PRODUCT_CODE = "launch_boost";
const PRODUCT_TITLE = "Launch Boost";
const PRODUCT_DESCRIPTION = "48 hours of additional distribution for one published KULT game.";

const GENERATION_PRODUCT_CODE = "game_generation";
const GENERATION_PRODUCT_TITLE = "Game Generation";

// Built-in Stars price per tier (Telegram Stars = "XTR"). Overridable via
// PAID_GAME_PRICE_STARS_TIER{n}. Telegram requires a positive integer amount.
const DEFAULT_STARS_PRICE = { 1: 50, 2: 150, 3: 400 };

export function generationStarsPrice(tier) {
  const n = [1, 2, 3].includes(Number(tier)) ? Number(tier) : 1;
  const value = Number(process.env[`PAID_GAME_PRICE_STARS_TIER${n}`]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_STARS_PRICE[n];
}

export function starsPaymentAvailable() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function launchBoostConfig() {
  return {
    code: PRODUCT_CODE,
    title: PRODUCT_TITLE,
    description: PRODUCT_DESCRIPTION,
    starsPrice: Number(process.env.LAUNCH_BOOST_STARS || 249),
    durationHours: Number(process.env.LAUNCH_BOOST_DURATION_HOURS || 48),
    impressionBudget: Number(process.env.LAUNCH_BOOST_IMPRESSION_BUDGET || 2500),
    botConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN)
  };
}

async function collections() {
  const db = await getDatabase();
  const orders = db.collection(ORDERS_COLLECTION);
  const events = db.collection(EVENTS_COLLECTION);
  const boosts = db.collection(BOOSTS_COLLECTION);
  await Promise.all([
    orders.createIndex({ id: 1 }, { unique: true, name: "star_orders_id_unique" }),
    orders.createIndex({ invoicePayload: 1 }, { unique: true, name: "star_orders_payload_unique" }),
    orders.createIndex({ userId: 1, createdAt: -1 }, { name: "star_orders_user_created" }),
    orders.createIndex({ gameId: 1, status: 1 }, { name: "star_orders_game_status" }),
    orders.createIndex({ telegramPaymentChargeId: 1 }, { unique: true, sparse: true, name: "star_orders_tg_charge_unique" }),
    events.createIndex({ telegramUpdateId: 1 }, { unique: true, name: "telegram_events_update_unique" }),
    boosts.createIndex({ id: 1 }, { unique: true, name: "game_boosts_id_unique" }),
    boosts.createIndex({ orderId: 1 }, { unique: true, name: "game_boosts_order_unique" }),
    boosts.createIndex({ gameId: 1, status: 1, endsAt: -1 }, { name: "game_boosts_game_status_ends" })
  ]);
  return { orders, events, boosts };
}

function publicOrder(order) {
  if (!order) return null;
  const { _id, ...rest } = order;
  void _id;
  return rest;
}

function assertTelegramBuyer(auth) {
  if (!auth?.telegramUserId) {
    const error = new Error("Telegram account is required for Stars payments");
    error.status = 403;
    throw error;
  }
}

async function createInvoiceLink(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    const error = new Error("TELEGRAM_BOT_TOKEN is not configured");
    error.status = 500;
    throw error;
  }

  const title = order.productTitle || PRODUCT_TITLE;
  const description = order.productDescription || PRODUCT_DESCRIPTION;
  const response = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      payload: order.invoicePayload,
      currency: "XTR",
      prices: [{ label: title, amount: order.starsAmount }],
      provider_token: "",
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.result) {
    const error = new Error(data.description || "Telegram invoice creation failed");
    error.status = 502;
    throw error;
  }
  return data.result;
}

export async function createLaunchBoostOrder({ auth, gameId }) {
  assertTelegramBuyer(auth);
  const game = await getGamePackageById(gameId);
  if (!game) {
    const error = new Error("Game not found");
    error.status = 404;
    throw error;
  }
  if (game.creatorId && !authOwnsIdentity(auth, game.creatorId)) {
    const error = new Error("Only the creator can boost this game");
    error.status = 403;
    throw error;
  }
  if (game.publish?.published !== true) {
    const error = new Error("Only published games can be boosted");
    error.status = 409;
    throw error;
  }

  const config = launchBoostConfig();
  const now = new Date();
  const order = {
    id: `star_order_${nanoid(16)}`,
    userId: auth.userId,
    telegramUserId: String(auth.telegramUserId),
    productCode: PRODUCT_CODE,
    productTitle: PRODUCT_TITLE,
    gameId,
    gameTitle: game.title ?? null,
    status: "CREATED",
    currency: "XTR",
    starsAmount: config.starsPrice,
    invoicePayload: `launch_boost:${gameId}:${auth.telegramUserId}:${nanoid(18)}`,
    invoiceUrl: null,
    telegramPaymentChargeId: null,
    providerPaymentChargeId: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    fulfilledAt: null,
    refundedAt: null
  };

  const { orders } = await collections();
  await orders.insertOne(order);
  let invoiceUrl;
  try {
    invoiceUrl = await createInvoiceLink(order);
  } catch (error) {
    await orders.updateOne(
      { id: order.id },
      { $set: { status: "FAILED", failureReason: error.message, updatedAt: new Date() } }
    );
    throw error;
  }
  await orders.updateOne(
    { id: order.id },
    { $set: { invoiceUrl, status: "INVOICE_CREATED", updatedAt: new Date() } }
  );
  return publicOrder({ ...order, invoiceUrl, status: "INVOICE_CREATED" });
}

export async function getStarOrder({ auth, orderId }) {
  const { orders } = await collections();
  const order = await orders.findOne({ id: orderId }, { projection: { _id: 0 } });
  if (!order) return null;
  if (order.userId !== auth?.userId) {
    const error = new Error("You can only view your own Stars orders");
    error.status = 403;
    throw error;
  }
  return publicOrder(order);
}

// Creates a Telegram Stars invoice to pay for ONE game generation on a tier.
// Unlike Launch Boost there is no on-payment fulfillment — the order is simply
// marked PAID by the webhook, then consumed when the generation runs.
export async function createGenerationStarsOrder({ auth, tier }) {
  assertTelegramBuyer(auth);
  const t = [1, 2, 3].includes(Number(tier)) ? Number(tier) : 1;
  const starsAmount = generationStarsPrice(t);
  const now = new Date();
  const order = {
    id: `star_order_${nanoid(16)}`,
    userId: auth.userId,
    telegramUserId: String(auth.telegramUserId),
    productCode: GENERATION_PRODUCT_CODE,
    productTitle: GENERATION_PRODUCT_TITLE,
    productDescription: `Generate one Tier ${t} game on KULT.`,
    tier: t,
    gameId: null,
    gameTitle: null,
    status: "CREATED",
    currency: "XTR",
    starsAmount,
    invoicePayload: `game_generation:${auth.telegramUserId}:${t}:${nanoid(18)}`,
    invoiceUrl: null,
    telegramPaymentChargeId: null,
    providerPaymentChargeId: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    consumedAt: null,
    refundedAt: null
  };

  const { orders } = await collections();
  await orders.insertOne(order);
  let invoiceUrl;
  try {
    invoiceUrl = await createInvoiceLink(order);
  } catch (error) {
    await orders.updateOne(
      { id: order.id },
      { $set: { status: "FAILED", failureReason: error.message, updatedAt: new Date() } }
    );
    throw error;
  }
  await orders.updateOne(
    { id: order.id },
    { $set: { invoiceUrl, status: "INVOICE_CREATED", updatedAt: new Date() } }
  );
  return publicOrder({ ...order, invoiceUrl, status: "INVOICE_CREATED" });
}

// Atomically verifies a PAID generation order belongs to this user and matches
// the tier, then marks it consumed so one payment yields exactly one game. Throws
// a 402 if it isn't paid yet, 403 if it isn't the caller's, 409 if already used.
export async function consumeGenerationStarsOrder({ auth, orderId, tier }) {
  const { orders } = await collections();
  const order = await orders.findOne({ id: orderId }, { projection: { _id: 0 } });
  if (!order || order.productCode !== GENERATION_PRODUCT_CODE) {
    const error = new Error("Stars generation order not found");
    error.status = 404;
    throw error;
  }
  const ownsOrder =
    order.userId === auth?.userId ||
    (auth?.telegramUserId && order.telegramUserId === String(auth.telegramUserId));
  if (!ownsOrder) {
    const error = new Error("You can only use your own Stars order");
    error.status = 403;
    throw error;
  }
  const t = [1, 2, 3].includes(Number(tier)) ? Number(tier) : 1;
  if (Number(order.tier) !== t) {
    const error = new Error(`This Stars payment was for Tier ${order.tier}, not Tier ${t}.`);
    error.status = 409;
    throw error;
  }
  if (order.status === "FULFILLED" || order.consumedAt) {
    const error = new Error("This Stars payment was already used for a game.");
    error.status = 409;
    throw error;
  }
  if (order.status !== "PAID") {
    const error = new Error("Stars payment not confirmed yet. Complete the payment in Telegram.");
    error.status = 402;
    error.code = "STARS_PAYMENT_PENDING";
    throw error;
  }
  // Atomic consume: only the first request that flips PAID→FULFILLED wins.
  const result = await orders.findOneAndUpdate(
    { id: order.id, status: "PAID" },
    { $set: { status: "FULFILLED", consumedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: "after", projection: { _id: 0 } }
  );
  const updated = result?.value ?? result;
  if (!updated || updated.status !== "FULFILLED") {
    const error = new Error("This Stars payment was already used for a game.");
    error.status = 409;
    throw error;
  }
  return {
    method: "stars",
    orderId: order.id,
    starsAmount: order.starsAmount,
    telegramPaymentChargeId: order.telegramPaymentChargeId
  };
}

async function answerPreCheckoutQuery(query, ok, errorMessage) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !query?.id) return;
  await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pre_checkout_query_id: query.id,
      ok,
      ...(ok ? {} : { error_message: errorMessage || "Payment could not be verified" })
    })
  }).catch(() => null);
}

async function activateBoost(order, payment) {
  const { orders, boosts } = await collections();
  const now = new Date();
  const config = launchBoostConfig();
  const endsAt = new Date(now.getTime() + config.durationHours * 60 * 60 * 1000);
  const boost = {
    id: `boost_${nanoid(16)}`,
    orderId: order.id,
    gameId: order.gameId,
    creatorId: order.userId,
    status: "ACTIVE",
    startsAt: now,
    endsAt,
    impressionBudget: config.impressionBudget,
    impressionsServed: 0,
    qualifiedPlays: 0,
    createdAt: now,
    updatedAt: now
  };

  await boosts.updateOne(
    { orderId: order.id },
    { $setOnInsert: boost },
    { upsert: true }
  );
  const storedBoost = await boosts.findOne({ orderId: order.id }, { projection: { _id: 0 } });
  await orders.updateOne(
    { id: order.id },
    {
      $set: {
        status: "FULFILLED",
        telegramPaymentChargeId: payment?.telegram_payment_charge_id ?? null,
        providerPaymentChargeId: payment?.provider_payment_charge_id ?? null,
        paidAt: order.paidAt ?? now,
        fulfilledAt: now,
        updatedAt: now
      }
    }
  );
  await updateGamePackageFields(order.gameId, {
    launchBoost: {
      active: true,
      boostId: storedBoost?.id ?? boost.id,
      orderId: order.id,
      startsAt: storedBoost?.startsAt ?? now,
      endsAt: storedBoost?.endsAt ?? endsAt,
      starsAmount: order.starsAmount
    }
  });
  await logActivity({
    userId: order.userId,
    gameId: order.gameId,
    gameTitle: order.gameTitle,
    activityType: "major_edit",
    details: `Activated Launch Boost for "${order.gameTitle || "game"}"`
  }).catch(() => null);
  return storedBoost ?? boost;
}

export async function handleTelegramPaymentUpdate(update) {
  const { events, orders } = await collections();
  const updateId = update?.update_id;
  if (updateId == null) return { ok: true, duplicate: false };

  const eventType = update.pre_checkout_query
    ? "pre_checkout_query"
    : update.message?.successful_payment
      ? "successful_payment"
      : "ignored";
  const invoicePayload =
    update.pre_checkout_query?.invoice_payload ??
    update.message?.successful_payment?.invoice_payload ??
    null;

  try {
    await events.insertOne({
      telegramUpdateId: updateId,
      eventType,
      invoicePayload,
      telegramPaymentChargeId: update.message?.successful_payment?.telegram_payment_charge_id ?? null,
      rawPayload: update,
      processedAt: null,
      processingError: null,
      createdAt: new Date()
    });
  } catch (error) {
    if (error.code === 11000) return { ok: true, duplicate: true };
    throw error;
  }

  if (update.pre_checkout_query) {
    const order = invoicePayload
      ? await orders.findOne({ invoicePayload }, { projection: { _id: 0 } })
      : null;
    const expectedAmount = Number(order?.starsAmount ?? 0);
    const receivedAmount = Number(update.pre_checkout_query.total_amount ?? 0);
    const ok = Boolean(order && order.status !== "FULFILLED" && receivedAmount === expectedAmount);
    await orders.updateOne(
      { invoicePayload },
      { $set: { status: ok ? "PRECHECKOUT_APPROVED" : "PRECHECKOUT_REJECTED", updatedAt: new Date() } }
    );
    await answerPreCheckoutQuery(update.pre_checkout_query, ok, ok ? undefined : "Invalid or expired Launch Boost order");
  }

  if (update.message?.successful_payment) {
    const payment = update.message.successful_payment;
    const order = await orders.findOne({ invoicePayload: payment.invoice_payload }, { projection: { _id: 0 } });
    if (order) {
      await orders.updateOne(
        { id: order.id },
        {
          $set: {
            status: "PAID",
            telegramPaymentChargeId: payment.telegram_payment_charge_id ?? null,
            providerPaymentChargeId: payment.provider_payment_charge_id ?? null,
            paidAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
      // Launch Boost fulfills immediately (activate the boost). A game-generation
      // order stays PAID until the generation request consumes it — the game is
      // built when the user retries, not here.
      if (order.productCode === PRODUCT_CODE) {
        await activateBoost({ ...order, paidAt: new Date() }, payment);
      }
    }
  }

  await events.updateOne({ telegramUpdateId: updateId }, { $set: { processedAt: new Date() } });
  return { ok: true, duplicate: false };
}
