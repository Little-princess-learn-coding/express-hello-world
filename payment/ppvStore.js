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
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { onSaleSuccess } from "../state/userState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.TELEGRAM_AURELIABOT_TOKEN;
const BASE_URL = process.env.BASE_URL; // https://yourdomain.com
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE || "live";
const PAYPAL_API = PAYPAL_MODE === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;

// ============================================================
// 📦 CATALOG — Điền album thật của Aurelia vào đây
// ============================================================
export const CATALOG = {
  "red_kitty": {
    id: "red_kitty",
    name: "Cute little kitty in red ꒦˘∪꒷",
    description: "6 pics",
    photoCount: 6,
    price: 35,
    deliveryType: "telegram_album",  // ← quan trọng
    photoIds: [
      "AgACAgUAAyEFAATnyo_qAAMDaZk8WIy2z4HBqXTG3606omUtdeEAApYNaxtKa8hUsB52DjoYKu8BAAMCAAN5AAM6BA",  // ảnh 1
      "AgACAgUAAyEFAATnyo_qAAMGaZk8WFV5kPS1VAgsB0EyTPxEK9gAApUNaxtKa8hUyvFSVbMC2GYBAAMCAAN5AAM6BA",  // ảnh 2
      "AgACAgUAAyEFAATnyo_qAAMFaZk8WP2-tKojKJpSnKJXk-7IFSQAApMNaxtKa8hUCFaoC55vLqkBAAMCAAN5AAM6BA",
      "AgACAgUAAyEFAATnyo_qAAMEaZk8WPmys0XAPVNMF1uu5LxudV4AApENaxtKa8hUvsQ4no_VDP8BAAMCAAN5AAM6BA",
      "AgACAgUAAyEFAATnyo_qAAMHaZk8WGrF29UDhtpR5OIavHNZDXgAApINaxtKa8hUM5manuBCKEgBAAMCAAN5AAM6BA",
      "AgACAgUAAyEFAATnyo_qAAMIaZk8WL1PX4VzogjNoOYFOjEGdeIAApQNaxtKa8hUYJu_SZbxFtwBAAMCAAN5AAM6BA",
    ],
    previewPhotoId: "AgACAgUAAyEFAATnyo_qAAMVaZlMQO8uDn7YpwpYDvEhbwIanA0AAqwNaxtKa8hUe5dqfcbVwjkBAAMCAAN5AAM6BA", // ảnh preview hiện khi bot đề xuất
  },
};

// ============================================================
// 🛒 CART & ORDER STATE
// ============================================================
const carts = new Map();         // chatId → productId (1 item cart)
const pendingOrders = new Map(); // orderId → { chatId, productId, amount, method }

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
  const product = CATALOG[productId];
  if (!product) return;

  const caption =
    `Viewing product *${product.name}*\n` +
    `_${product.description}_\n\n` +
    `📸 ${product.photoCount} photos  ·  💰 $${product.price.toFixed(2)}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: `💳  Buy now ($${product.price.toFixed(2)})`, callback_data: `buy_now:${productId}` }],
      [{ text: "◀️  Back to shop", callback_data: "shop_home" }],
    ],
  };

  // Gửi ảnh preview kèm caption và buttons
  const previewPath = path.resolve(__dirname, "..", product.previewPhoto);

  if (fs.existsSync(previewPath)) {
    // Gửi ảnh dạng file stream
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("chat_id", chatId.toString());
    form.append("caption", caption);
    form.append("parse_mode", "Markdown");
    form.append("reply_markup", JSON.stringify(keyboard));
    form.append("photo", fs.createReadStream(previewPath));

    await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
      method: "POST",
      body: form,
    });
  } else {
    // Fallback: gửi text nếu không có ảnh
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
  const keyboard = {
    inline_keyboard: Object.values(CATALOG).map(p => ([
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
  const product = CATALOG[productId];
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
  const product = CATALOG[productId];
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
  const product = CATALOG[productId];
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
    pendingOrders.set(order.id, { chatId, productId, amount: product.price, method: "paypal", createdAt: Date.now() });

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
  const product = CATALOG[productId];
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
  const product = CATALOG[productId];
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

    pendingOrders.set(payment.payment_id.toString(), {
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
  const product = CATALOG[productId];
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
    // 1. Cảm ơn
    const thankYous = ["omg thank u so much!! 🥺💕", "payment confirmed~", "sending ur files now babe!"];
    for (const msg of thankYous) {
      await tg("sendMessage", { chat_id: chatId, text: msg });
      await sleep(1000 + Math.random() * 800);
    }

    // 2. Gửi file
    const filePath = path.resolve(__dirname, "..", product.filePath);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      await tg("sendMessage", { chat_id: chatId, text: "i'll send it manually in a sec! 🌸" });
      return;
    }

    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("chat_id", chatId.toString());
    form.append("caption", `✨ ${product.name}\n\nEnjoy~ 💕`);

    if (product.fileType === "mp4") {
      form.append("video", fs.createReadStream(filePath));
      form.append("supports_streaming", "true");
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendVideo`, { method: "POST", body: form });
    } else {
      form.append("document", fs.createReadStream(filePath));
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, { method: "POST", body: form });
    }

    // 3. Follow-up
    await sleep(2000);
    const followUps = ["hope u love it 🥰", "lmk what u think ok~ 💕", "enjoy babe~ 🌸"];
    await tg("sendMessage", { chat_id: chatId, text: followUps[Math.floor(Math.random() * followUps.length)] });

    console.log(`✅ Delivered ${product.name} to ${chatId}`);
  } catch (err) {
    console.error(`❌ Delivery failed for ${chatId}:`, err);
    await tg("sendMessage", { chat_id: chatId, text: "something went wrong, i'll send manually! 😢" });
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
    const order = pendingOrders.get(orderId);
    if (order && resource?.status === "COMPLETED") {
      await deliverContent(order.chatId, order.productId, "paypal", orderId, users);
      pendingOrders.delete(orderId);
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
    const order = pendingOrders.get(payment_id.toString());
    if (order) {
      await deliverContent(order.chatId, order.productId, "crypto", payment_id, users);
      pendingOrders.delete(payment_id.toString());
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
