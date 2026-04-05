/**
 * ============================================================
 * AURELIA PPV STORE — Giống Miyurin bot
 * Flow: Xem album preview → Add to cart / Buy now → Chọn payment → Auto deliver
 * 
 * TÍCH HỢP VÀO app.js:
 * import { ppvStore } from './payment/ppvStore.js';
 * ppvStore.init(app);   // sau app.use(express.json())
 * 
 * Trong webhook handler, thêm:
 * if (await ppvStore.handleCallback(req.body)) return res.sendStatus(200);
 * ============================================================
 */

import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { onSaleSuccess } from "../state/userState.js";

const TOKEN = process.env.TELEGRAM_AURELIABOT_TOKEN;
const BASE_URL = process.env.BASE_URL;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE || "live";
const PAYPAL_API = PAYPAL_MODE === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;

const getSupabase = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ============================================================
// 📦 CATALOG — Đọc từ Supabase, cache trong RAM
// ============================================================
let _catalogCache = null;
let _catalogCachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút

export async function getCatalog() {
  const now = Date.now();
  if (_catalogCache && now - _catalogCachedAt < CACHE_TTL_MS) return _catalogCache;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ppv_products")
    .select("*")
    .eq("is_active", true);

  if (error) {
    console.error("❌ Failed to load catalog from Supabase:", error.message);
    return _catalogCache || {};
  }

  // Convert array → object keyed by product_id (giống CATALOG cũ)
  const catalog = {};
  for (const row of data) {
    catalog[row.product_id] = {
      id: row.product_id,
      name: row.name,
      description: row.description,
      photoCount: row.photo_count,
      price: parseFloat(row.price),
      deliveryType: row.delivery_type || "telegram_album",
      photoIds: row.photo_ids || [],
      previewPhotoId: row.preview_photo_id,
    };
  }

  _catalogCache = catalog;
  _catalogCachedAt = now;
  console.log(`📦 Catalog loaded: ${data.length} products`);
  return catalog;
}

export function invalidateCatalogCache() {
  _catalogCache = null;
  _catalogCachedAt = 0;
  console.log("🔄 Catalog cache cleared");
}

// Backward-compat: CATALOG object (sync, dùng cache hiện tại hoặc {})
// app.js dùng CATALOG trực tiếp ở 1 chỗ — giờ nên dùng getCatalog() thay thế
export const CATALOG = new Proxy({}, {
  get(_, key) {
    return _catalogCache?.[key];
  },
  ownKeys() {
    return Object.keys(_catalogCache || {});
  },
  has(_, key) {
    return key in (_catalogCache || {});
  },
  getOwnPropertyDescriptor(_, key) {
    if (_catalogCache && key in _catalogCache)
      return { enumerable: true, configurable: true, value: _catalogCache[key] };
  }
});

// ============================================================
// 🛒 CART & ORDER STATE
// ============================================================
const carts = new Map(); // chatId → productId (1 item cart)

// ── pendingOrders: RAM + Supabase backup ──
// RAM cho fast lookup, Supabase để survive server restart
const pendingOrders = new Map();

async function savePendingOrder(orderId, data) {
  pendingOrders.set(orderId, data);
  try {
    const supabase = getSupabase();
    await supabase.from("pending_orders").upsert({
      order_id: orderId,
      chat_id: data.chatId,
      product_id: data.productId,
      amount: data.amount,
      method: data.method,
      created_at: new Date().toISOString(),
    }, { onConflict: "order_id" });
  } catch (e) {
    console.error("savePendingOrder error:", e.message);
  }
}

async function getPendingOrder(orderId) {
  // Check RAM first
  if (pendingOrders.has(orderId)) return pendingOrders.get(orderId);
  // Fallback to Supabase (after server restart)
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from("pending_orders")
      .select("*").eq("order_id", orderId).single();
    if (data) {
      const order = { chatId: data.chat_id, productId: data.product_id, amount: data.amount, method: data.method };
      pendingOrders.set(orderId, order); // restore to RAM
      return order;
    }
  } catch (e) {
    console.error("getPendingOrder error:", e.message);
  }
  return null;
}

async function deletePendingOrder(orderId) {
  pendingOrders.delete(orderId);
  try {
    const supabase = getSupabase();
    await supabase.from("pending_orders").delete().eq("order_id", orderId);
  } catch (e) {
    console.error("deletePendingOrder error:", e.message);
  }
}

// ============================================================
// 📨 TELEGRAM API HELPERS
// ============================================================
const tg = (method, body) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// 🖼️ GỬI ALBUM PREVIEW (giống Miyurin bot - ảnh + caption + buttons)
// ============================================================
export async function sendAlbumPreview(chatId, productId) {
  const catalog = await getCatalog();
  const product = catalog[productId];
  if (!product) return;

  const caption =
    `Viewing product *${product.name}*\n` +
    `_${product.description}_\n\n` +
    `📸 ${product.photoCount} photos  ·  💰 $${product.price.toFixed(2)}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: `💳  Buy now ($${product.price.toFixed(2)})`, callback_data: `buy_now:${productId}` }],
    ],
  };

  if (product.previewPhotoId) {
    // Gửi ảnh preview bằng file_id từ Supabase
    await tg("sendPhoto", {
      chat_id: chatId,
      photo: product.previewPhotoId,
      caption,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } else {
    // Fallback: text nếu chưa có preview
    await tg("sendMessage", {
      chat_id: chatId,
      text: caption,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }

  console.log(`🖼️ Album preview sent: ${productId} → ${chatId}`);
}

// ============================================================
// 🏪 SHOP HOME — Danh sách tất cả album
// ============================================================
export async function sendShopHome(chatId) {
  const catalog = await getCatalog();
  const keyboard = {
    inline_keyboard: Object.values(catalog).map(p => ([
      { text: `📸 ${p.name} — $${p.price.toFixed(2)}`, callback_data: `view_product:${p.id}` }
    ]))
  };

  await tg("sendMessage", {
    chat_id: chatId,
    text: "✨ *Aurelia's Shop*\n\nChọn album bạn muốn xem~",
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

// ============================================================
// 💳 GỬI PAYMENT OPTIONS (giống ảnh 2 - Crypto / PayPal / Back)
// ============================================================
async function sendPaymentOptions(chatId, productId) {
  const catalog = await getCatalog();
  const product = catalog[productId];
  if (!product) return;

  await tg("sendMessage", {
    chat_id: chatId,
    text: `Please select the option below to complete your payment.\n\n*${product.name}* — $${product.price.toFixed(2)}`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔐  Crypto (No KYC)", callback_data: `pay_crypto:${productId}` }],
        [{ text: "💳  PayPal", callback_data: `pay_paypal:${productId}` }],
        [{ text: "◀️  Back", callback_data: `view_product:${productId}` }],
      ],
    },
  });
}

// ============================================================
// 🛒 CART FLOW
// ============================================================
async function handleCartAdd(chatId, productId, callbackQueryId) {
  const catalog = await getCatalog();
  const product = catalog[productId];
  if (!product) return;

  carts.set(chatId, productId);

  // Answer callback (remove loading)
  await tg("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: "Added to cart! 🛒",
    show_alert: false,
  });

  await tg("sendMessage", {
    chat_id: chatId,
    text: `🛒 *Cart*\n\n📸 ${product.name}\n💰 $${product.price.toFixed(2)}\n\nReady to checkout?`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅  Checkout", callback_data: `checkout:${productId}` }],
        [{ text: "🏪  Continue shopping", callback_data: "shop_home" }],
        [{ text: "🗑️  Remove from cart", callback_data: `cart_remove:${productId}` }],
      ],
    },
  });
}

// ============================================================
// 💰 PAYPAL — Tạo order + gửi link
// ============================================================
async function handlePayPalPayment(chatId, productId, callbackQueryId) {
  const catalog = await getCatalog();
  const product = catalog[productId];
  if (!product) return;

  await tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Creating PayPal order..." });

  try {
    const accessToken = await getPayPalAccessToken();
    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: `${chatId}_${productId}_${Date.now()}`,
          description: product.name,
          amount: { currency_code: "USD", value: product.price.toFixed(2) },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
              brand_name: "Aurelia",
              locale: "en-US",
              landing_page: "LOGIN",
              user_action: "PAY_NOW",
              return_url: `${BASE_URL}/payment/paypal/success`,
              cancel_url: `${BASE_URL}/payment/paypal/cancel`,
            },
          },
        },
      }),
    });

    const order = await orderRes.json();
    if (!order.id) throw new Error("PayPal order failed: " + JSON.stringify(order));

    // Save pending order
    await savePendingOrder(order.id, { chatId, productId, amount: product.price, method: "paypal", createdAt: Date.now() });

    const approvalUrl = order.links.find(l => l.rel === "payer-action")?.href;

    await tg("sendMessage", {
      chat_id: chatId,
      text: `💳 *PayPal Payment*\n\n${product.name} — $${product.price.toFixed(2)}\n\nClick the button below to pay~`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳  Pay with PayPal", url: approvalUrl }],
          [{ text: "◀️  Back", callback_data: `view_product:${productId}` }],
        ],
      },
    });

    console.log(`💳 PayPal order created: ${order.id} for ${chatId}`);
  } catch (err) {
    console.error("PayPal error:", err);
    await tg("sendMessage", { chat_id: chatId, text: "Sorry, something went wrong! Try again or contact me 🥺" });
  }
}

// ============================================================
// 🔐 CRYPTO — Tạo payment + gửi địa chỉ
// ============================================================
async function handleCryptoPayment(chatId, productId, callbackQueryId) {
  const catalog = await getCatalog();
  const product = catalog[productId];
  if (!product) return;

  await tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Creating crypto payment..." });

  // Hỏi user muốn dùng coin nào
  await tg("sendMessage", {
    chat_id: chatId,
    text: `🔐 *Crypto Payment*\n\n${product.name} — $${product.price.toFixed(2)}\n\nChoose your preferred coin~`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "💵 USDT", callback_data: `crypto_coin:${productId}:usdt` },
          { text: "₿ BTC", callback_data: `crypto_coin:${productId}:btc` },
        ],
        [
          { text: "Ξ ETH", callback_data: `crypto_coin:${productId}:eth` },
          { text: "Ł LTC", callback_data: `crypto_coin:${productId}:ltc` },
        ],
        [{ text: "◀️  Back", callback_data: `view_product:${productId}` }],
      ],
    },
  });
}

async function handleCryptoCoin(chatId, productId, coin, callbackQueryId) {
  const catalog = await getCatalog();
  const product = catalog[productId];
  if (!product) return;

  await tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text: `Creating ${coin.toUpperCase()} payment...` });

  try {
    const res = await fetch("https://api.nowpayments.io/v1/payment", {
      method: "POST",
      headers: { "x-api-key": NOWPAYMENTS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        price_amount: product.price,
        price_currency: "usd",
        pay_currency: coin,
        order_id: `${chatId}_${productId}_${Date.now()}`,
        order_description: product.name,
        ipn_callback_url: `${BASE_URL}/payment/crypto/webhook`,
      }),
    });

    const payment = await res.json();
    if (!payment.payment_id) throw new Error("NOWPayments failed: " + JSON.stringify(payment));

    await savePendingOrder(payment.payment_id.toString(), {
      chatId, productId, amount: product.price, method: "crypto", coin, createdAt: Date.now()
    });

    const coinEmoji = { usdt: "💵", btc: "₿", eth: "Ξ", ltc: "Ł" }[coin] || "🔐";
    const expireMin = 60;

    await tg("sendMessage", {
      chat_id: chatId,
      text:
        `${coinEmoji} *${coin.toUpperCase()} Payment*\n\n` +
        `*Amount:* \`${payment.pay_amount} ${coin.toUpperCase()}\`\n` +
        `*Address:* \`${payment.pay_address}\`\n\n` +
        `_Send exactly the amount above to the address._\n` +
        `_Content will be delivered automatically after confirmation_ ✅\n\n` +
        `⏰ Expires in ${expireMin} minutes`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔗  View payment status", url: `https://nowpayments.io/payment/?iid=${payment.payment_id}` }],
          [{ text: "◀️  Back", callback_data: `view_product:${productId}` }],
        ],
      },
    });

    console.log(`🔐 Crypto payment created: ${payment.payment_id} (${coin}) for ${chatId}`);
  } catch (err) {
    console.error("Crypto error:", err);
    await tg("sendMessage", { chat_id: chatId, text: "Sorry, something went wrong! Try again 🥺" });
  }
}

// ============================================================
// ✅ DELIVER CONTENT — Gửi file sau khi thanh toán xong
// ============================================================
export async function deliverContent(chatId, productId, method, paymentRef, users = null) {
  const catalog = await getCatalog();
  const product = catalog[productId];
  if (!product) { console.error(`Product not found: ${productId}`); return; }

  console.log(`📦 Delivering ${product.name} to ${chatId} (${method})`);

  // ✅ Cập nhật user state nếu có
  if (users && users[chatId]) {
    const user = users[chatId];
    onSaleSuccess(user.state);
    user.relationship_level = Math.min(10, (user.relationship_level || 0) + 2);
    if (user.stages?.current >= 5) user.stages.current = 6;
    console.log(`✅ Sale success recorded for ${chatId}`);
  }

  try {
    // Gửi album — batch 10 ảnh/lần
    const photoIds = product.photoIds || [];
    if (photoIds.length === 0) {
      console.error(`No photos for product: ${productId}`);
      return;
    }

    const BATCH = 10;
    for (let i = 0; i < photoIds.length; i += BATCH) {
      const batch = photoIds.slice(i, i + BATCH);
      const media = batch.map(fileId => ({ type: "photo", media: fileId }));
      await tg("sendMediaGroup", { chat_id: chatId, media });
      if (i + BATCH < photoIds.length) await sleep(1500);
    }

    console.log(`✅ Delivered ${product.name} to ${chatId}`);
  } catch (err) {
    console.error(`❌ Delivery failed for ${chatId}:`, err);
  }
}

// ============================================================
// 🔔 WEBHOOK HANDLERS
// ============================================================

// PayPal webhook
export async function handlePayPalWebhook(req, users = null) {
  const { event_type, resource } = req.body;
  console.log(`📨 PayPal webhook: ${event_type}`);

  if (event_type === "CHECKOUT.ORDER.APPROVED") {
    const orderId = resource?.id;
    if (orderId) await capturePayPalPayment(orderId);
    return true;
  }

  if (event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const orderId = resource?.supplementary_data?.related_ids?.order_id || resource?.id;
    const order = await getPendingOrder(orderId);
    if (order && resource?.status === "COMPLETED") {
      await deliverContent(order.chatId, order.productId, "paypal", orderId, users);
      await deletePendingOrder(orderId);
    }
    return true;
  }

  return false;
}

async function capturePayPalPayment(orderId) {
  const accessToken = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  const data = await res.json();
  console.log(`💰 PayPal captured: ${data.status}`);
  return data;
}

// NOWPayments webhook
export async function handleCryptoWebhook(req, users = null) {
  const signature = req.headers["x-nowpayments-sig"];
  const hmac = crypto.createHmac("sha512", NOWPAYMENTS_IPN_SECRET)
    .update(JSON.stringify(req.body)).digest("hex");

  if (signature !== hmac) {
    console.warn("⚠️ Invalid crypto webhook signature");
    return false;
  }

  const { payment_id, payment_status } = req.body;
  console.log(`📨 Crypto webhook: ${payment_id} → ${payment_status}`);

  if (payment_status === "finished" || payment_status === "confirmed") {
    const order = await getPendingOrder(payment_id.toString());
    if (order) {
      await deliverContent(order.chatId, order.productId, "crypto", payment_id, users);
      await deletePendingOrder(payment_id.toString());
    }
    return true;
  }

  return false;
}

// ============================================================
// 🎮 CALLBACK QUERY HANDLER — Xử lý tất cả button presses
// ============================================================
export async function handleCallbackQuery(callbackQuery) {
  const { id, data, from } = callbackQuery;
  const chatId = from.id;

  if (!data) return false;

  console.log(`🎮 Callback: ${data} from ${chatId}`);

  // View product
  if (data.startsWith("view_product:")) {
    const productId = data.split(":")[1];
    await tg("answerCallbackQuery", { callback_query_id: id });
    await sendAlbumPreview(chatId, productId);
    return true;
  }

  // Shop home
  if (data === "shop_home") {
    await tg("answerCallbackQuery", { callback_query_id: id });
    await sendShopHome(chatId);
    return true;
  }

  // Add to cart
  if (data.startsWith("cart_add:")) {
    const productId = data.split(":")[1];
    await handleCartAdd(chatId, productId, id);
    return true;
  }

  // Remove from cart
  if (data.startsWith("cart_remove:")) {
    carts.delete(chatId);
    await tg("answerCallbackQuery", { callback_query_id: id, text: "Removed from cart 🗑️" });
    await sendShopHome(chatId);
    return true;
  }

  // Buy now → go to payment options
  if (data.startsWith("buy_now:")) {
    const productId = data.split(":")[1];
    await tg("answerCallbackQuery", { callback_query_id: id });
    await sendPaymentOptions(chatId, productId);
    return true;
  }

  // Checkout (từ cart)
  if (data.startsWith("checkout:")) {
    const productId = data.split(":")[1];
    await tg("answerCallbackQuery", { callback_query_id: id });
    await sendPaymentOptions(chatId, productId);
    return true;
  }

  // Pay via PayPal
  if (data.startsWith("pay_paypal:")) {
    const productId = data.split(":")[1];
    await handlePayPalPayment(chatId, productId, id);
    return true;
  }

  // Pay via Crypto → chọn coin
  if (data.startsWith("pay_crypto:")) {
    const productId = data.split(":")[1];
    await handleCryptoPayment(chatId, productId, id);
    return true;
  }

  // Chọn coin cụ thể
  if (data.startsWith("crypto_coin:")) {
    const [, productId, coin] = data.split(":");
    await handleCryptoCoin(chatId, productId, coin, id);
    return true;
  }

  return false;
}

// ============================================================
// 🔌 INIT — Đăng ký routes vào Express app
// ============================================================
export function initPPVRoutes(app, users = null) {

  // PayPal webhook
  app.post("/payment/paypal/webhook", async (req, res) => {
    try {
      await handlePayPalWebhook(req, users);
    } catch (e) {
      console.error("PayPal webhook error:", e);
    }
    res.sendStatus(200);
  });

  // PayPal return pages
  app.get("/payment/paypal/success", (_, res) => res.send(`
    <html><body style="background:#0a0608;color:white;font-family:sans-serif;text-align:center;padding:50px">
      <h2>✅ Payment Approved!</h2>
      <p>Your content will be delivered to Telegram shortly 💕</p>
      <p style="color:#888;font-size:12px">You can close this window</p>
    </body></html>`));

  app.get("/payment/paypal/cancel", (_, res) => res.send(`
    <html><body style="background:#0a0608;color:white;font-family:sans-serif;text-align:center;padding:50px">
      <h2>Payment Cancelled</h2><p>No worries, come back anytime 🌸</p>
    </body></html>`));

  // NOWPayments webhook
  app.post("/payment/crypto/webhook", async (req, res) => {
    try {
      await handleCryptoWebhook(req, users);
    } catch (e) {
      console.error("Crypto webhook error:", e);
    }
    res.sendStatus(200);
  });

  // Admin: gửi PPV offer thủ công
  app.post("/admin/send-album", async (req, res) => {
    const { chatId, productId, adminKey } = req.body;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
    if (!CATALOG[productId]) return res.status(400).json({ error: "Invalid productId", available: Object.keys(CATALOG) });
    await sendAlbumPreview(chatId, productId);
    res.json({ success: true });
  });

  // Danh sách products
  app.get("/shop/products", (_, res) => {
    res.json(Object.values(CATALOG).map(p => ({ id: p.id, name: p.name, price: p.price, photos: p.photoCount })));
  });

  console.log("✅ PPV routes registered");
}

// ============================================================
// PayPal Token Helper
// ============================================================
async function getPayPalAccessToken() {
  const credentials = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  return data.access_token;
}
