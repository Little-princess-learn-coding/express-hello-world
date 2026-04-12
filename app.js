import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import {
  createInitialUserState,
  onUserMessage,
  onSaleSuccess,
  onSaleFailure,
  onSaleAttempt,
  resetWeeklyCounter,
  isTimeWaster,
  isSupporter,
  isStranger,
  isCasual,
  getStateSummary
} from "./state/userState.js";

import PPV_SALE_PROMPT from "./prompts/ppv_sale.js";
import FIRST_SALE_GUIDE from "./prompts/1st.saleGuide.js";
import REPEATED_SALE_GUIDE from "./prompts/repeated_sale.js";
import SYSTEM_PROMPT_BASE from "./prompts/systemPrompt.js";
import { buildPreciseOpenAIPrompt, buildPreciseGrokPrompt } from "./prompts/precisionStage.js";

// ✅ Supabase Memory DB + RAG
import {
  loadFanProfile,
  saveFanProfile,
  createFanProfile,
  saveMemory,
  getMemories,
  searchMemories,
  savePurchase,
  buildFanContext,
  saveMessage,
  getMessages,
  checkTakeover,
  setTakeover,
} from "./database/memoryDB.js";
import { extractAndSaveMemories, buildRAGContextPrompt } from "./database/ragEngine.js";

import {
  parseAssetMarkers,
  getAssetToSend,
  getPendingConfirmations,
  scheduleConfirmation,
  markAssetSent,
  getLastSentGift,
} from "./assets/assetEngine.js";
import { registerAsset, invalidateAssetCache, getRandomAssetByType } from "./assets/assetRegistry.js";

import {
  sendAsset,
  sendUploadPhoto,
  sendPhoto
} from "./assets/telegramAssets.js";

import { logUserMessage, logBotMessage, handleAdminMessage } from "./user_monitoring/monitoringSystem.js";
import { isWaitingAdmin } from "./user_monitoring/monitoringDb.js";

import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// ✅ PPV Store — album preview + PayPal + Crypto
import {
  initPPVRoutes,
  handleCallbackQuery,
  handlePayPalWebhook,
  handleCryptoWebhook,
  sendAlbumPreview,
  sendShopHome,
  deliverContent,
  getCatalog,
  invalidateCatalogCache,
  CATALOG,
} from "./payment/ppvStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

// ✅ Đăng ký PPV routes — được gọi sau khi users object được khai báo (xem phía dưới)
// initPPVRoutes(app, users) — gọi ở cuối file setup

/* ================== PLATFORM LINKS ================== */
const KOFI_LINK = "https://ko-fi.com/badbunny_08";
const PAYPAL_USERNAME = "littleprincess08";
const PAYPAL_LINK = "https://paypal.me/littleprincess08";

/* ================== CONTEXT MANAGER (inline) ================== */

function createConversationContext() {
  return {
    currentTopic: null,
    topicHistory: [],
    lastTopicChange: null,
    moodHistory: [],
    dominantMood: "neutral",
    moodTrend: "stable",
    summary: null,
    summaryAt: 0,
    openThreads: [],
    emotionalMoments: [],
  };
}

function detectTopic(text) {
  if (/(cosplay|costume|character|anime|genshin|miku|nezuko|outfit)/i.test(text)) return "cosplay";
  if (/(game|gaming|play|rank|valorant|lol|fps)/i.test(text)) return "gaming";
  if (/(work|job|class|school|study|tired|busy|stress)/i.test(text)) return "daily_life";
  if (/(sexy|hot|cute|beautiful|gorgeous|babe|baby)/i.test(text)) return "flirting";
  if (/(support|buy|purchase|pay|ko-fi|paypal|photo|pic)/i.test(text)) return "support";
  if (/(eat|food|hungry|lunch|dinner|coffee)/i.test(text)) return "daily_life";
  if (/(feel|feeling|sad|happy|miss|lonely|love)/i.test(text)) return "emotional";
  return null;
}

function isQuestion(text) {
  return /\?$/.test(text.trim()) ||
    /^(what|when|where|who|how|why|do you|are you|can you|will you)/i.test(text.trim());
}

function summarizeQuestion(text) {
  const lower = text.toLowerCase().trim();
  if (lower.length < 60) return lower.replace(/[?!.]$/, "").trim();
  return lower.substring(0, 50) + "...";
}

function detectEmotionalMoment(text) {
  if (/(i love you|ur my fav|you're amazing|thank you so much)/i.test(text)) return "fan expressed strong affection";
  if (/(stressed|depressed|sad|lonely|hard day|bad day)/i.test(text)) return "fan shared emotional difficulty";
  if (/(birthday|anniversary|special day)/i.test(text)) return "fan mentioned special occasion";
  if (/(i bought|i paid|i sent|just paid)/i.test(text)) return "fan completed a purchase";
  return null;
}

function calculateDominantMood(moodHistory) {
  if (moodHistory.length === 0) return "neutral";
  const counts = { positive: 0, neutral: 0, negative: 0 };
  moodHistory.forEach((m, i) => {
    const weight = (i + 1) / moodHistory.length;
    counts[m.mood] = (counts[m.mood] || 0) + weight;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : "neutral";
}

function calculateMoodTrend(moodHistory) {
  if (moodHistory.length < 4) return "stable";
  const moodScore = { positive: 1, neutral: 0, negative: -1 };
  const recent = moodHistory.slice(-3).map(m => moodScore[m.mood] || 0);
  const older = moodHistory.slice(-6, -3).map(m => moodScore[m.mood] || 0);
  if (!recent.length || !older.length) return "stable";
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  if (recentAvg > olderAvg + 0.3) return "improving";
  if (recentAvg < olderAvg - 0.3) return "declining";
  return "stable";
}

function buildMoodGuide(dominantMood, moodTrend) {
  const guides = {
    positive: "=== MOOD GUIDE ===\nFan is in a GOOD mood — match their energy, be playful and warm.",
    neutral: "=== MOOD GUIDE ===\nFan seems NEUTRAL — keep it natural, don't force excitement.",
    negative: "=== MOOD GUIDE ===\nFan seems DOWN — be gentle, show care. Skip sales. Ask what's wrong briefly.",
  };
  let guide = guides[dominantMood] || guides.neutral;
  if (moodTrend === "improving") guide += "\nMood is getting better — you can be warmer and more playful.";
  if (moodTrend === "declining") guide += "\nMood is dropping — slow down, be more caring and attentive.";
  return guide + "\n";
}

function formatFacts(memoryFacts) {
  if (!memoryFacts) return "No known facts yet.";
  const known = Object.entries(memoryFacts)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return known || "No known facts yet.";
}

function updateConversationContext(user, messageText, role = "user", intentData = null) {
  if (!user.conversationContext) user.conversationContext = createConversationContext();
  const ctx = user.conversationContext;

  if (role === "user") {
    if (intentData?.mood) {
      ctx.moodHistory.push({ mood: intentData.mood, at: Date.now() });
      if (ctx.moodHistory.length > 10) ctx.moodHistory.shift();
      ctx.dominantMood = calculateDominantMood(ctx.moodHistory);
      ctx.moodTrend = calculateMoodTrend(ctx.moodHistory);
    }

    const detectedTopic = detectTopic(messageText);
    if (detectedTopic && detectedTopic !== ctx.currentTopic) {
      if (ctx.currentTopic) {
        const existing = ctx.topicHistory.find(t => t.topic === ctx.currentTopic);
        if (existing) existing.messageCount++;
        else ctx.topicHistory.push({ topic: ctx.currentTopic, startedAt: ctx.lastTopicChange || Date.now(), messageCount: 1 });
      }
      ctx.currentTopic = detectedTopic;
      ctx.lastTopicChange = Date.now();
    }

    if (isQuestion(messageText)) {
      const thread = summarizeQuestion(messageText);
      if (thread && !ctx.openThreads.includes(thread)) {
        ctx.openThreads.push(thread);
        if (ctx.openThreads.length > 5) ctx.openThreads.shift();
      }
    }

    const emotionalMoment = detectEmotionalMoment(messageText);
    if (emotionalMoment) {
      ctx.emotionalMoments.push(emotionalMoment);
      if (ctx.emotionalMoments.length > 5) ctx.emotionalMoments.shift();
    }
  }

  if (role === "bot" && ctx.openThreads.length > 0) {
    ctx.openThreads.shift();
  }
}

async function refreshConversationSummary(user) {
  if (!user.conversationContext) return;
  const ctx = user.conversationContext;
  if (user.message_count - ctx.summaryAt < 10) return;

  const recentConvo = user.recentMessages.slice(-20).join("\n");
  const knownFacts = formatFacts(user.memoryFacts);

  const systemPrompt = `You summarize Telegram conversations between a cosplayer named Aurelia and a fan.
Return a SHORT summary (2-3 sentences max) covering who the fan is, what they've been talking about, emotional vibe, and any open topics.
Write in plain English. Be concise. No bullet points.`;

  try {
    const summary = await callOpenAI(systemPrompt, `Known facts: ${knownFacts}\n\nConversation:\n${recentConvo}\n\nSummarize.`);
    ctx.summary = summary.trim();
    ctx.summaryAt = user.message_count;
    console.log(`📝 Summary updated for ${user.chatId}`);
  } catch (e) {
    console.error("Summary refresh failed:", e.message);
  }
}

/* ================== REPLY-TO-MESSAGE LOGIC ================== */

// shouldQuoteReply — chỉ quyết định có QUOTE tin nhắn hay không
// Bot LUÔN reply, hàm này chỉ ảnh hưởng UI quote bubble
function shouldQuoteReply(user, text) {
  if (/\?$/.test(text.trim())) return true;       // có câu hỏi → quote
  if (user.message_count <= 3) return true;         // tin đầu → quote
  return false;                                      // còn lại → không quote, rep bình thường
}

// ================================================================
// CONVERSATION END LOGIC
// Case 1: User chủ động bye → bot reply ngắn → đóng
// Case 2: Bot chủ động bye (sau sale / deep night) → user reply bất cứ gì → bot chúc ngủ ngon → đóng
// ================================================================

function detectUserGoodbye(userText) {
  return /(\bgbye\b|\bbye\b|goodbye|see ya|see u later|talk later|talk 2 u later|talk to u later|\bgotta go\b|ttyl|\bcya\b|good night|goodnight|i have to go|i gotta go|i need to go|going now|heading out|back to work|back to class|im busy now)/i.test(userText);
}

function detectMutualGoodbye(user, botReply, userText) {
  // Case 1: User nói bye → bot acknowledge → đóng
  if (detectUserGoodbye(userText)) {
    const botAcknowledges = /(bye|see ya|see u|goodnight|good night|talk later|talk soon|ttyl|take care)/i.test(botReply);
    return botAcknowledges;
  }

  // Case 2: Bot đã chủ động propose goodbye trước → user reply bất cứ gì → bot đã gửi final message → đóng
  if (user.bot_initiated_goodbye && user.bot_sent_final_goodbye) {
    return true;
  }

  return false;
}

/* ================== STAGE SYSTEM ================== */

function detectAskForPhotos(text) {
  return /(see.*photo|see.*pic|your photo|your pics|show me|can i see|your cosplay)/i.test(text);
}

function detectEmotionalSupport(text) {
  // Must be explicit fan/support declaration — not generic "yes" or "sure"
  return /(i['']ll be your fan|i will be your fan|i support you|i['']m your fan|count me in as.*fan|i want to be your fan)/i.test(text);
}

function botAskedForSupport(text) {
  return /(ko-fi|support me|buy my|help me saving|support my)/i.test(text);
}

// ❌ detectSaleSuccess đã bị xóa
// ✅ Thanh toán giờ được xác nhận tự động qua PayPal webhook + NOWPayments webhook
// → ppvStore.js xử lý và gọi deliverContent() + onSaleSuccess() tự động

function detectCosplayQuestion(text) {
  // Only if user is asking about cosplay, not just mentioning it casually
  return /(do you cosplay|are you a cosplayer|what do you cosplay|who do you cosplay|ur a cosplayer|you cosplay)/i.test(text);
}

function detectHobbyQuestion(text) {
  // Only explicit questions about hobbies/interests
  return /(what('s| is) ur hobby|what are ur hobbies|what do u do for fun|what r ur interests|ur hobbies|ur interests)/i.test(text);
}

// Detect khi user nói đã gửi tiền/tip/donate (chưa confirm)
function detectUserSentPayment(text) {
  return /(i sent|i('ve)? sent|just sent|already sent|i paid|i('ve)? paid|just paid|i transferred|i tipped|i donated|sent (you|u|through|via)|paid (you|u|through|via)|through (paypal|ko-?fi)|via (paypal|ko-?fi))/i.test(text);
}

// Detect khi user confirm "yes" sau khi bot hỏi "did u send it?"
function detectUserConfirmedPayment(text) {
  return /^(yes|yep|yeah|yup|yea|i did|i have|done|sent|confirmed|of course|sure|absolutely|correct|right|true|uh huh|mhm|👍|✅)[\s!.]*$/i.test(text.trim());
}

// Detect khi user từ chối / chưa gửi tiền
function detectPaymentRejected(text) {
  return /(not yet|i don'?t|i haven'?t|i can'?t|no i|nope|not enough|maybe later|i didn'?t|haven'?t sent|didn'?t send|no money|broke)/i.test(text);
}

function detectFlirtyExcessive(text) {
  const flirtyKeywords = ["sexy", "hot", "beautiful pics", "send nudes", "show me more", "you're hot", "so sexy", "gorgeous", "stunning pics", "wanna see you", "show yourself", "babe", "baby", "cutie"];
  const lower = text.toLowerCase();
  return flirtyKeywords.some(k => lower.includes(k));
}

function initializeStageTracking(user) {
  if (!user.stages) {
    user.stages = { current: 1, completed: [], skipped: [], ppv_sale_triggered: false };
  }
}

function updateStage(user, newStage, reason = "") {
  if (!user.stages) initializeStageTracking(user);
  const oldStage = user.stages.current;
  if (!user.stages.completed.includes(oldStage)) user.stages.completed.push(oldStage);
  if (newStage > oldStage + 1) {
    for (let i = oldStage + 1; i < newStage; i++) {
      if (!user.stages.skipped.includes(i)) user.stages.skipped.push(i);
    }
  }
  user.stages.current = newStage;
  console.log(`📍 Stage ${oldStage} → ${newStage} (${reason})`);
}

function detectStageTransition(user, text) {
  initializeStageTracking(user);
  const currentStage = user.stages.current;

  if (detectFlirtyExcessive(text) && detectAskForPhotos(text)) {
    user.stages.ppv_sale_triggered = true;
    return { trigger: "ppv_sale", newStage: "ppv", reason: "User flirty + asking for photos" };
  }
  if (detectAskForPhotos(text) && currentStage < 5) {
    user.stages.ppv_sale_triggered = true;
    return { trigger: "ppv_sale_mild", newStage: "ppv", reason: "User asking for photos" };
  }
  if (detectCosplayQuestion(text) && currentStage < 3) {
    updateStage(user, 3, "User asked about cosplay");
    return { trigger: "stage_3", newStage: 3, reason: "User asked about cosplay" };
  }
  if (detectHobbyQuestion(text) && currentStage < 2) {
    updateStage(user, 2, "User asked about hobbies");
    return { trigger: "stage_2", newStage: 2, reason: "User asked about hobbies" };
  }
  if (detectEmotionalSupport(text) && currentStage === 4) {
    user.emotional_ready = true;
    updateStage(user, 5, "User showed emotional support");
    return { trigger: "stage_5", newStage: 5, reason: "User ready for sale" };
  }
  // Stage transitions are now driven entirely by AI following the checkpoint guide
  // Do NOT auto-advance based on message count — that bypasses the conversation flow
  return null;
}

function getStageInstructions(user) {
  const stage = user.stages?.current || 1;
  const stageLabel = stage === "5A" ? "5 (SOFT SALE)" : stage;
  return `${FIRST_SALE_GUIDE}\n\n==============================\nCURRENT CHECKPOINT: ${stageLabel}\n==============================\nFollow CHECKPOINT ${stageLabel} instructions above. Stay in this checkpoint unless the user naturally leads forward.`;
}

/* ================== REPEAT SALE STRATEGY ================== */

function selectRepeatStrategy(user, intentData, recentMessages) {
  const conversationText = recentMessages.slice(-6).join(" ").toLowerCase();

  if (/(another girl|other cosplayer|she is|her cosplay|that girl|other girls|another woman)/i.test(conversationText))
    return { strategy: "jealousy", confidence: 0.95, reason: "User mentioned another girl/cosplayer", canBypass: true };

  if (intentData.mood === "neutral" && /(how are you|you okay|feeling|take care|rest|tired|sick)/i.test(conversationText))
    return { strategy: "unwell", confidence: 0.75, reason: "User showing care/concern", canBypass: false };

  const messagesSinceLastSale = user.state.lastSaleAt
    ? user.message_count - (user.state.lastSaleMessageCount || 0)
    : user.message_count;
  const isDryConversation = messagesSinceLastSale > 15;

  if (intentData.mood === "positive" || isDryConversation)
    return { strategy: "joke", confidence: 0.7, reason: isDryConversation ? "Dry conversation" : "User in good mood", canBypass: false };

  if (intentData.mood === "positive" || intentData.mood === "neutral")
    return { strategy: "gifts", confidence: 0.6, reason: "Safe default", canBypass: false };

  if (intentData.mood === "negative")
    return { strategy: null, confidence: 0, reason: "User in negative mood", canBypass: false };

  return { strategy: "gifts", confidence: 0.5, reason: "Fallback", canBypass: false };
}

/* ================== SALE TIMING ================== */

function shouldAttemptSaleByTiming(user) {
  const now = Date.now();
  if (!user.state.weeklyResetAt) user.state.weeklyResetAt = now;

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  // Reset weekly counter
  if (now - user.state.weeklyResetAt >= weekMs) {
    user.state.weeklySaleAttempts = 0;
    user.state.weeklyResetAt = now;
  }

  const weeklySales = user.state.weeklySaleAttempts || 0;
  const daysSinceReset = (now - user.state.weeklyResetAt) / dayMs;

  // Hard cap: max 3 per week
  if (weeklySales >= 3)
    return { allow: false, reason: `Weekly limit reached (${weeklySales}/3)` };

  // Cooldown between attempts
  if (user.state.lastSaleAt) {
    const hoursSince = (now - user.state.lastSaleAt) / (1000 * 60 * 60);
    const minCooldown = isSupporter(user.state) ? 24 : 48;
    if (hoursSince < minCooldown) {
      // FORCE override if week is running out and minimum not met
      // Need 2/week minimum — force if day 5+ and still < 2 attempts
      const weekAlmostOver = daysSinceReset >= 5;
      const belowMinimum = weeklySales < 2;
      if (weekAlmostOver && belowMinimum) {
        console.log(`⚡ Force sale override — day ${Math.floor(daysSinceReset)}, only ${weeklySales}/2 attempts this week`);
        return { allow: true, force: true, reason: `Forced — week ending, only ${weeklySales}/2 sales done` };
      }
      return { allow: false, reason: `Cooldown active (${Math.round(minCooldown - hoursSince)}h remaining)` };
    }
  }

  // Force sale if day 4+ and below minimum (2/week)
  if (daysSinceReset >= 4 && weeklySales < 2) {
    return { allow: true, force: true, reason: `Forced — day ${Math.floor(daysSinceReset)}, need ${2 - weeklySales} more sale(s) this week` };
  }

  return { allow: true, force: false, reason: "Timing check passed" };
}

/* ================== CONTEXT CHECKING ================== */

function isConversationSuitableForSale(user, intentData, recentMessages) {
  if (intentData.mood === "negative") return { suitable: false, reason: "User in negative mood" };
  if (user.message_count < 3) return { suitable: false, reason: "Too early (< 3 messages)" };
  if (intentData.windDown) return { suitable: false, reason: "User ending conversation" };

  const lastBotMessage = recentMessages.filter(m => m.startsWith("Aurelia:")).slice(-1)[0] || "";
  if (botAskedForSupport(lastBotMessage)) return { suitable: false, reason: "Just asked for support" };

  const conversationText = recentMessages.join(" ");
  if (detectAskForPhotos(conversationText) || /(your album|your cosplay|support you|buy from you)/i.test(conversationText))
    return { suitable: true, userInitiated: true, reason: "User showed interest" };

  if ((intentData.mood === "positive" || intentData.mood === "neutral") && user.message_count >= 5)
    return { suitable: true, reason: "Good conversation flow" };

  return { suitable: true, reason: "Context check passed" };
}

/* ================== AI CALLS ================== */


// ============================================================
// VOICE TRANSCRIPTION — Groq Whisper
// Download .ogg từ Telegram → transcribe → return text
// ============================================================
async function transcribeVoice(fileId) {
  try {
    // Step 1: Get file path from Telegram
    const fileInfoRes = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const fileInfo = await fileInfoRes.json();
    if (!fileInfo.ok) throw new Error('getFile failed: ' + JSON.stringify(fileInfo));
    const filePath = fileInfo.result.file_path;

    // Step 2: Download file as buffer
    const fileRes = await fetch(
      `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`
    );
    if (!fileRes.ok) throw new Error('File download failed');
    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Step 3: Send to Groq Whisper via FormData
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', buffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'text');
    // Hint: fan is likely speaking English or Vietnamese
    form.append('language', 'en');

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      if (groqRes.status === 429 || errText.includes('quota')) {
        sendAdminAlert('💳 Groq hết quota!\nVoice messages không được transcribe.\nKiểm tra tại: console.groq.com', 'groq_quota');
      }
      throw new Error('Groq Whisper error: ' + errText);
    }

    const transcript = (await groqRes.text()).trim();
    return transcript || null;
  } catch (e) {
    console.error('transcribeVoice error:', e.message);
    return null;
  }
}


// ============================================================
// ADMIN ALERT — gửi Telegram message cho admin khi có lỗi nghiêm trọng
// ============================================================
const alertCooldowns = new Map(); // tránh spam alert cùng 1 lỗi

async function sendAdminAlert(message, errorKey = 'general') {
  // Cooldown 30 phút mỗi loại lỗi — tránh spam
  const lastSent = alertCooldowns.get(errorKey) || 0;
  if (Date.now() - lastSent < 30 * 60 * 1000) return;
  alertCooldowns.set(errorKey, Date.now());

  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!adminIds.length) return;

  const time = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const text = `🚨 AURELIA ALERT\n\n${message}\n\n🕐 ${time}`;

  for (const adminId of adminIds) {
    try {
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: adminId, text }),
      });
    } catch (e) {
      console.error('sendAdminAlert error:', e.message);
    }
  }
}




async function callOpenAI(systemPrompt, userMessage) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
      temperature: 0.7,
      max_tokens: 80,
    }),
  });
  const data = await response.json();
  if (response.status === 401 || data.error?.code === 'invalid_api_key') {
    sendAdminAlert('❌ OpenAI API key không hợp lệ hoặc đã bị thu hồi.\nKiểm tra lại OPENAI_API_KEY trong Render env.', 'openai_auth');
    throw new Error('OpenAI auth error');
  }
  if (response.status === 429 || data.error?.code === 'insufficient_quota') {
    sendAdminAlert('💳 OpenAI hết credit!\nBot không thể reply cho fans.\nNạp thêm tại: platform.openai.com/account/billing', 'openai_quota');
    throw new Error('OpenAI quota exceeded');
  }
  if (!data.choices || !data.choices[0]) throw new Error("OpenAI returned no choices");
  return data.choices[0].message.content;
}

async function callGrok(systemPrompt, contextPrompt, userMessage) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model: "grok-3",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: contextPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.95,
      max_tokens: 80,
    }),
  });
  const data = await response.json();
  if (response.status === 401 || data.error?.code === 'invalid_api_key') {
    sendAdminAlert('❌ xAI (Grok) API key không hợp lệ hoặc đã bị thu hồi.\nKiểm tra lại XAI_API_KEY trong Render env.', 'grok_auth');
    throw new Error('Grok auth error');
  }
  if (response.status === 429 || data.error?.type === 'insufficient_quota') {
    sendAdminAlert('💳 xAI (Grok) hết credit!\nBot không thể reply khi user flirty hoặc ppv_sale.\nNạp thêm tại: console.x.ai', 'grok_quota');
    throw new Error('Grok quota exceeded');
  }
  if (!data.choices || !data.choices[0]) throw new Error(`Grok returned no choices: ${JSON.stringify(data).substring(0, 200)}`);
  return data.choices[0].message.content;
}

async function classifyImage(imageUrl) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model: "grok-2-vision-1212",
      messages: [
        { role: "system", content: "You classify photos sent to a girlfriend-vibe chatbot. Be conservative." },
        { role: "user", content: [{ type: "text", text: "Classify into ONE: selfie, body_flex, pet, food, scenery, meme, other. Reply ONLY with category name." }, { type: "image_url", image_url: imageUrl }] }
      ],
      temperature: 0,
      max_tokens: 10,
    }),
  });
  const data = await response.json();
  if (!data.choices || !data.choices[0]) return 'other';
  return data.choices[0].message.content.trim();
}

async function classifyMessageAndExtractFacts(user, userMessage, recentMessages) {
  const conversationContext = recentMessages.slice(-12).join("\n");
  const systemPrompt = `You are an analyzer for a cosplayer chatbot named Aurelia.
Analyze the user message and return TWO things in ONE JSON response:
1. INTENT: intent ("flirt"|"normal"), mood ("positive"|"neutral"|"negative"), saleResponse ("yes"|"no"|"maybe"|"none"), windDown (bool)
2. FACTS: name, age, location (city/country only), job — ONLY extract from the USER's own message.
   CRITICAL rules for fact extraction:
   - Do NOT extract facts from Aurelia's messages
   - "job" means their PROFESSION/OCCUPATION — not activities ("i have to work today" is NOT a job)
   - Only extract job if user states their actual role: "i'm a teacher", "i work as engineer", "i study finance"
   - "i have to go to work" / "going to work" = activity, NOT a job → do not extract
   - name must be explicitly stated: "i'm David", "call me John" — not assumed
   - age must be a number they state about themselves
   - location = city or country they say they're from
   Example GOOD: "im a software engineer" → job="software engineer"
   Example BAD: "i have to go to work" → job=null (this is an activity, not a profession)
Respond ONLY in this exact JSON (no extra text):
{"intent":"flirt or normal","mood":"positive or neutral or negative","saleResponse":"yes or no or maybe or none","windDown":false,"facts":{}}`;

  const userPrompt = `Recent conversation (for context only — do NOT extract facts from Aurelia's lines):\n${conversationContext}\n\nCurrent USER message to analyze: "${userMessage}"\nSale status: ${user.has_asked_support}, mode: ${user.conversation_mode}`;

  try {
    const response = await callOpenAI(systemPrompt, userPrompt);
    const clean = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(clean);
    if (!result.intent || !result.mood || !result.saleResponse) throw new Error("Invalid response");
    return {
      intent: { intent: result.intent, mood: result.mood, saleResponse: result.saleResponse, windDown: result.windDown || false },
      facts: result.facts || {}
    };
  } catch (error) {
    console.error("Classification failed:", error);
    return { intent: { intent: "normal", mood: "neutral", saleResponse: "none", windDown: false }, facts: {} };
  }
}

/* ================== PROMPT BUILDERS ================== */

async function buildContextPrompt(user, strategy, timeContext) {
  const ctx = user.conversationContext || createConversationContext();
  const stateSummary = getStateSummary(user.state);

  // Build "DO NOT ASK" list
  const doNotAsk = [];
  const f = user.memoryFacts || {};
  if (f.name) doNotAsk.push(`their name (it's ${f.name})`);
  if (f.location) doNotAsk.push(`where they're from (it's ${f.location})`);
  if (f.age) doNotAsk.push(`their age (${f.age})`);
  if (f.job) doNotAsk.push(`their job (${f.job})`);

  const summarySection = ctx.summary ? `=== CONVERSATION SUMMARY ===\n${ctx.summary}\n` : "";
  const doNotAskSection = doNotAsk.length > 0 ? `\n=== NEVER ASK AGAIN ===\nYou already know: ${doNotAsk.join(", ")}. Do NOT ask about these.\n` : "";
  const topicSection = ctx.currentTopic ? `Currently talking about: ${ctx.currentTopic}\n` : "";
  const moodSection = `Fan mood: ${ctx.dominantMood} (trend: ${ctx.moodTrend})\n`;
  const threadsSection = ctx.openThreads.length > 0 ? `⚠️ Fan asked but not answered: ${ctx.openThreads[0]}\n` : "";
  const momentsSection = ctx.emotionalMoments.length > 0 ? `Notable: ${ctx.emotionalMoments.slice(-2).join(", ")}\n` : "";

  // ✅ RAG: Load memories từ Supabase
  let ragSection = "";
  try {
    const keywords = user.currentKeywords || [];
    const fanCtx = await buildFanContext(user.chatId, null, keywords);
    if (fanCtx?.contextString) {
      ragSection = `\n=== LONG-TERM MEMORY (from past conversations) ===\n${fanCtx.contextString}\n`;
    }
  } catch (e) {
    // RAG failed silently — không block response
  }

  // Build PPV section — inject available (unsent) PPV list for smart selection
  let ppvSection = '';
  try {
    const catalog = await getCatalog();
    const allIds = Object.keys(catalog || {});
    const sentIds = user.ppv_sent || [];
    const availableIds = allIds.filter(id => !sentIds.includes(id));
    if (availableIds.length > 0 && (strategy === 'ppv_sale' || strategy === 'user_initiated_sale')) {
      const ppvList = availableIds.map(id => {
        const p = catalog[id];
        const theme = p.theme || p.description || '(no theme)';
        return `- ${id}: ${p.name} | theme: ${theme} | $${p.price}`;
      }).join('\n');
      ppvSection = `\n=== AVAILABLE PPV (choose best match for conversation context) ===\n${ppvList}\nOutput [SEND:ppv_ID] with the exact product_id that fits best.`;
    }
  } catch(e) { /* silent */ }

  return `
${summarySection}
=== FAN PROFILE ===
${formatFacts(user.memoryFacts)}
${doNotAskSection}
=== CONVERSATION STATE ===
${topicSection}${moodSection}${threadsSection}${momentsSection}
=== RELATIONSHIP ===
State: ${stateSummary.state}
Messages: ${stateSummary.messages}
Sales: ${stateSummary.totalSales} (${stateSummary.successfulSales} successful)
Weekly: ${stateSummary.weeklySales}/3
Stage: ${user.stages?.current || 1}
Emotional level: ${user.relationship_level}/10

=== TIME & MODE ===
Time of day: ${timeContext}
Current time in Vietnam (Da Nang): ${getVietnamTimeString()}
Mode: ${user.conversation_mode}

=== PAYMENT LINKS ===
Ko-fi: ${KOFI_LINK}
PayPal: @${PAYPAL_USERNAME} or ${PAYPAL_LINK}

PAYMENT RULES:
- First sale (stranger): Ko-fi ONLY → "${KOFI_LINK} 💕"
- Repeat sale (casual/supporter): PayPal → "@${PAYPAL_USERNAME}"

=== RECENT MESSAGES ===
${user.recentMessages.slice(-10).join("\n")}
${ragSection}
=== STRATEGY ===
${strategy || "normal_conversation"}
${ppvSection}
`;
}

function buildOpenAIPrompt(user, strategy) {
  const ctx = user.conversationContext || createConversationContext();
  const stageInstructions = getStageInstructions(user);

  const doNotAsk = [];
  const f = user.memoryFacts || {};
  if (f.name) doNotAsk.push(`their name (it's ${f.name})`);
  if (f.location) doNotAsk.push(`where they're from (it's ${f.location})`);
  if (f.age) doNotAsk.push(`their age (${f.age})`);
  if (f.job) doNotAsk.push(`their job (${f.job})`);

  const doNotAskSection = doNotAsk.length > 0
    ? `\n=== NEVER ASK AGAIN ===\nYou already know: ${doNotAsk.join(", ")}. Do NOT ask about these. It breaks immersion.\n`
    : "";

  const topicReminder = ctx.currentTopic
    ? `\n=== TOPIC CONTINUITY ===\nCurrently talking about: ${ctx.currentTopic}. Don't randomly switch topics.\n`
    : "";

  const moodGuide = buildMoodGuide(ctx.dominantMood, ctx.moodTrend);

  const threadReminder = ctx.openThreads.length > 0
    ? `\n=== ANSWER FIRST ===\nFan asked: "${ctx.openThreads[0]}" — address this before moving on.\n`
    : "";

  let windDownInstructions = "";
  if (user.wind_down) {
    const messagesLeft = 3 - (user.wind_down_messages_sent || 0);
    windDownInstructions = messagesLeft <= 1
      ? `\n=== WIND-DOWN - FINAL ===\n🌙 Say goodnight naturally. 1 sentence. e.g. "i feel sleepy… talk to u tmr 🤍"\n`
      : `\n=== WIND-DOWN ===\n🌙 Getting tired. Short replies (1-2 sentences). Goodnight in ${messagesLeft} messages.\n`;
  }

  return `${SYSTEM_PROMPT_BASE}

=== STAGE GUIDE ===
${stageInstructions}

STRATEGY NOTES:
${strategy === "first_sale" ? "- First time asking for support. Follow Stage 5 carefully." : ""}
${strategy === "repeat_sale" ? "- User has been asked before. Be casual." : ""}
${strategy === "clarify_sale" ? "- User ignored previous sale. Gently clarify without pushing." : ""}

${doNotAskSection}
${topicReminder}
${moodGuide}
${threadReminder}
${windDownInstructions}

USER STATE: ${user.state.relationship_state}
Stage: ${user.stages?.current || 1}
Emotional connection: ${user.relationship_level}/10

=== TEXTING STYLE (STRICT) ===
- Write like a real girl texting on phone, NOT an essay
- Each message = MAX 1 short sentence (8-12 words)
- To say 2 things → 2 SEPARATE lines (become separate messages)
- BAD: "hi there! I'm doing great, thanks! How about you?"
- GOOD: "hi!" / "doing great~" / "how about u?"
- Do NOT ask multiple questions in one reply
- Do NOT repeat info already said
- Do NOT start with "hi" if conversation already ongoing`;
}

function buildGrokPrompt(user, strategy, selectedStrategy = null) {
  const ctx = user.conversationContext || createConversationContext();

  const doNotAsk = [];
  const f = user.memoryFacts || {};
  if (f.name) doNotAsk.push(`their name (it's ${f.name})`);
  if (f.location) doNotAsk.push(`where they're from (it's ${f.location})`);

  const doNotAskSection = doNotAsk.length > 0
    ? `\n=== NEVER ASK AGAIN ===\nYou already know: ${doNotAsk.join(", ")}.\n`
    : "";

  const topicReminder = ctx.currentTopic
    ? `\n=== TOPIC CONTINUITY ===\nCurrently talking about: ${ctx.currentTopic}.\n`
    : "";

  const moodGuide = buildMoodGuide(ctx.dominantMood, ctx.moodTrend);

  let promptContent = "";
  if (strategy === "user_initiated_sale" || strategy === "ppv_sale") {
    promptContent = PPV_SALE_PROMPT;
  } else if (strategy === "repeat_sale" && selectedStrategy) {
    promptContent = `${REPEATED_SALE_GUIDE}

=== SELECTED STRATEGY ===
You MUST use: ${selectedStrategy.strategy.toUpperCase()}
Reason: ${selectedStrategy.reason}
Confidence: ${selectedStrategy.confidence}
Can bypass: ${selectedStrategy.canBypass}

CRITICAL: Follow EXACT tone for ${selectedStrategy.strategy.toUpperCase()} strategy. Make sale feel natural and emotionally driven. If user resists, gracefully drop it.
User mood: ${user.lastIntentData?.mood || "neutral"}
Stage: ${user.stages?.current || 1}`;
  } else {
    promptContent = getStageInstructions(user);
  }

  let windDownInstructions = "";
  if (user.wind_down) {
    const messagesLeft = 3 - (user.wind_down_messages_sent || 0);
    windDownInstructions = messagesLeft <= 1
      ? `\n=== WIND-DOWN - FINAL ===\n🌙 Say goodnight naturally. SHORT (1 sentence).\nExamples: "i feel sleepy… talk to u tmr 🤍" / "need to sleep, goodnight~ 💕"\n`
      : `\n=== WIND-DOWN ===\n🌙 Getting tired. SHORT replies. No new topics. No assets. No sales. Goodnight in ${messagesLeft} messages.\n`;
  }

  return `${SYSTEM_PROMPT_BASE}

=== GUIDE ===
${promptContent}
${doNotAskSection}
${topicReminder}
${moodGuide}
${windDownInstructions}

USER STATE: ${user.state.relationship_state}

=== TEXTING STYLE (STRICT) ===
- Write like a real girl texting on phone, NOT an essay
- Each message = MAX 1 short sentence (8-12 words)
- To say 2 things → 2 SEPARATE lines (become separate messages)
- BAD: "hi there! I'm doing great, thanks! How about you?"
- GOOD: "hi!" / "doing great~" / "how about u?"
- Do NOT ask multiple questions in one reply
- Do NOT repeat info already said
- Never mention Da Nang, your job, height, weight unless directly asked
- Use teencode naturally: k, r, u, ur, ngl, lol, omg, rly, smth, idk, bc
- Do NOT use "hey" or "hehe"`;
}

/* ================== USER STATE ================== */
const users = {};
const processingMessages = new Set();
const userBotReplying = new Set();
const userBotSending = new Set();
const userMessageQueue = new Map();
/* ================== MESSAGE BATCH BUFFER ================== */
// Gom tin nhắn liên tiếp của user trong 5s rồi xử lý 1 lần duy nhất
const messageBatchBuffer = new Map(); // chatId → { messages: [{text, messageId}], timer }

function flushMessageBatch(chatId) {
  const batch = messageBatchBuffer.get(chatId);
  if (!batch || batch.messages.length === 0) return;
  messageBatchBuffer.delete(chatId);

  const messages = batch.messages;
  const firstMessageId = messages[0].messageId; // quote the FIRST message, not the last

  let mergedText;
  if (messages.length === 1) {
    mergedText = messages[0].text;
  } else {
    const combined = messages.map(m => m.text).join("\n");
    mergedText = `[CONTEXT: user sent ${messages.length} quick messages — understand the full intent, reply naturally to the overall meaning]\n${combined}`;
  }
  // Quote-reply to the first message in the batch (the one that started the conversation turn)
  const user = users[chatId];
  if (user) user.lastIncomingMessageId = firstMessageId;

  console.log(`📦 Flushing batch for ${chatId}: ${messages.length} msg(s) merged`);

  if (!user) return;

  // Inject vào processing queue bình thường
  if (userBotReplying.has(chatId) || userBotSending.has(chatId)) {
    // Bot đang bận — enqueue và poll cho đến khi bot rảnh
    enqueueMessage(chatId, mergedText);
    waitAndDrainQueue(chatId);
  } else {
    // Bot rảnh — xử lý ngay
    userMessageQueue.set(chatId, [mergedText]);
    processNextInQueue(chatId);
  }
}

// Đợi bot rảnh rồi drain queue — dùng setInterval để tránh stack overflow
function waitAndDrainQueue(chatId) {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    if (attempts > 20) { clearInterval(interval); return; } // max 10s timeout
    if (!userBotReplying.has(chatId) && !userBotSending.has(chatId)) {
      clearInterval(interval);
      processNextInQueue(chatId);
    }
  }, 500);
}

function bufferOrFlushMessage(chatId, text, messageId) {
  if (!messageBatchBuffer.has(chatId)) {
    messageBatchBuffer.set(chatId, { messages: [], timer: null });
  }
  const batch = messageBatchBuffer.get(chatId);
  clearTimeout(batch.timer);
  batch.messages.push({ text, messageId });

  // Dynamic batch window: 11s if bot just asked a question, 4s otherwise
  const userObj = users[chatId];
  const lastBot = userObj?.recentMessages
    ? [...userObj.recentMessages].reverse().find(m => m.startsWith("Aurelia:"))
    : null;
  const lastBotText = lastBot ? lastBot.replace(/^Aurelia:\s*/, "").trim() : "";
  const botJustAskedQuestion = /[?]\s*$/.test(lastBotText);
  const batchDelay = botJustAskedQuestion ? 11000 : 4000;
  console.log(`⏱️ Batch window: ${batchDelay/1000}s ${botJustAskedQuestion ? '(bot asked question)' : ''}`);

  batch.timer = setTimeout(() => flushMessageBatch(chatId), batchDelay);
}



// ✅ Khởi động PPV routes SAU KHI users được khai báo
initPPVRoutes(app, users);

function enqueueMessage(chatId, text) {
  if (!userMessageQueue.has(chatId)) userMessageQueue.set(chatId, []);
  const queue = userMessageQueue.get(chatId);
  const lastQueued = queue[queue.length - 1];
  if (lastQueued && lastQueued.trim().toLowerCase() === text.trim().toLowerCase()) return;
  const user = users[chatId];
  if (user && user.recentMessages.length > 0) {
    const lastUserMsg = user.recentMessages.filter(m => m.startsWith("User:")).slice(-1)[0];
    if (lastUserMsg) {
      const lastText = lastUserMsg.replace(/^User:\s*/, "").trim().toLowerCase();
      if (lastText === text.trim().toLowerCase()) return;
    }
  }
  queue.push(text);
  console.log(`📥 Queued for ${chatId}: "${text.substring(0, 30)}..." (size: ${queue.length})`);
}

async function processNextInQueue(chatId) {
  const queue = userMessageQueue.get(chatId);
  if (!queue || queue.length === 0) return;
  const nextText = queue.shift();
  if (queue.length === 0) userMessageQueue.delete(chatId);
  const user = getUser(chatId);
  if (user) await processUserMessage(chatId, nextText, user);
}

function getUser(chatId, username = null) {
  if (!users[chatId]) {
    users[chatId] = {
      chatId,
      state: createInitialUserState(),
      conversation_mode: "idle",
      relationship_level: 0,
      last_conversation_at: null,
      wind_down: false,
      wind_down_messages_sent: 0,
      awaiting_first_message: false,
      greeting_timeout: null,
      start_timestamp: null,
      first_reply_pending: false,
      first_reply_scheduled_at: null,
      queued_messages: [],
      location_mentioned_in_queue: false,
      sale_clarification_pending: false,
      message_count: 0,
      created_at: Date.now(),
      last_active: Date.now(),
      recentMessages: [],
      memoryFacts: { name: null, age: null, location: null, job: null },
      conversationContext: createConversationContext(),
      firstReplySent: false,
      conversationClosed: false,
      bot_initiated_goodbye: false,  // bot đã chủ động đề nghị kết thúc
      bot_sent_final_goodbye: false, // bot đã gửi tin nhắn cuối (chúc ngủ ngon)
      has_seen_content: false,
      emotional_ready: false,
      has_asked_support: false,
      start_greeting_scheduled: false,
      start_greeting_sent: false,
      stages: { current: 1, completed: [], skipped: [], ppv_sale_triggered: false },
      first_sale_done: false,
      ppv_sent: [],        // PPV product_ids already sent to this user
      lastIntentData: null,
      // RAG state
      currentKeywords: [],
      fanContextCache: null,
    };

    // ✅ Load/create fan profile from Supabase — track when done so messages wait for it
    let resolveProfileLoaded;
    users[chatId].profileLoaded = new Promise(r => { resolveProfileLoaded = r; });

    loadFanProfile(chatId).then(async profile => {
      if (!profile) {
        await createFanProfile(chatId, username);
        console.log(`🆕 New fan profile created: ${chatId}`);
        resolveProfileLoaded();
      } else {
        // Restore persisted data
        const u = users[chatId];
        if (!u) return;
        if (profile.name) u.memoryFacts.name = profile.name;
        if (profile.age) u.memoryFacts.age = profile.age;
        if (profile.location) u.memoryFacts.location = profile.location;
        if (profile.job) u.memoryFacts.job = profile.job;
        if (profile.relationship_level) u.relationship_level = profile.relationship_level;
        if (profile.message_count) u.message_count = profile.message_count;
        if (profile.stage) u.stages.current = profile.stage;
        if (profile.ppv_sent) u.ppv_sent = profile.ppv_sent || [];
        if (profile.relationship_state) u.state.relationship_state = profile.relationship_state;
        // Restore first_sale_done — nếu không còn là stranger thì 1st sale đã xong
        if (profile.relationship_state && profile.relationship_state !== "stranger") {
          u.first_sale_done = true;
        }
        console.log(`📂 Fan profile loaded: ${chatId} (${profile.relationship_state}, stage ${profile.stage})`);
        resolveProfileLoaded();
        // Restore recent chat history from DB so context survives server restarts
        getMessages(chatId, 20).then(msgs => {
          if (msgs && msgs.length > 0 && u.recentMessages.length === 0) {
            u.recentMessages = msgs.map(m =>
              m.role === 'fan' ? `User: ${m.content}` : `Aurelia: ${m.content}`
            );
            console.log(`📜 Restored ${msgs.length} messages for ${chatId}`);
          }
        }).catch(() => {});
      }
    }).catch(e => { console.error("loadFanProfile error:", e); resolveProfileLoaded(); });
  }
  return users[chatId];
}

function updateUser(chatId, updates) {
  const user = getUser(chatId);
  Object.assign(user, updates);
  user.last_active = Date.now();
}

/* ================== UTILS ================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getVietnamTime() {
  // Use Intl API — reliable on any server timezone
  const now = new Date();
  const vnStr = now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" });
  return new Date(vnStr);
}

function getVietnamHour() {
  const now = new Date();
  return parseInt(now.toLocaleString("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "numeric",
    hour12: false
  }), 10);
}

function getTimeContext() {
  const hour = getVietnamHour();
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  if (hour >= 22 || hour < 2) return "night";
  return "deep_night";
}

function getVietnamTimeString() {
  return new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function calculateDelay(user, replyText) {
  // Base delay by relationship — stranger feels slower/more hesitant
  const baseDelay = { stranger: 1500, casual: 1000, supporter: 700 }[user.state.relationship_state] || 1200;
  // Typing speed: ~45ms per char (realistic human typing ~220 chars/min)
  const perChar = 45;
  // Random human variance: ±800ms
  const random = (Math.random() - 0.3) * 800;
  // Short messages: 1.5s–3s, long messages: up to 10s
  const raw = baseDelay + replyText.length * perChar + random;
  return Math.max(1500, Math.min(raw, 10000));
}

function shouldDelayFirstReply(user) {
  if (!user.firstReplySent && isStranger(user.state)) return true;
  const thirtyMin = 30 * 60 * 1000;
  if (user.last_active && (Date.now() - user.last_active) > thirtyMin) return true;
  return false;
}

function formatUserFacts(user) {
  if (!user.memoryFacts) return "No known facts yet.";
  const known = Object.entries(user.memoryFacts)
    .filter(([_, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  if (!known) return "No known facts yet.";
  return `${known}\n\nIMPORTANT: You already know the above. Do NOT ask again.`;
}

async function sendTyping(chatId) {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      signal: controller.signal,
    });
    clearTimeout(tid);
  } catch (e) {
    // Non-critical — never crash reply flow over typing indicator
  }
}

function splitIntoBursts(text) {
  // Split by newlines first
  let parts = text.split(/\n+/).map(t => t.trim()).filter(Boolean);
  // Deduplicate consecutive identical lines
  parts = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[i-1].toLowerCase());
  // Strip trailing period — real texting never ends with "."
  parts = parts.map(p => p.replace(/\.+$/, '').trim());
  // Remove any "!" that slipped through
  parts = parts.map(p => p.replace(/!/g, '~').trim());
  parts = parts.filter(Boolean);
  // Cap at 4 bubbles max
  if (parts.length > 4) {
    parts = [...parts.slice(0, 3), parts.slice(3).join(' ')];
  }
  return parts;
}

// ✅ UPDATED: Thêm replyToMessageId parameter
async function sendBurstReplies(user, chatId, text, replyToMessageId = null) {
  const parts = splitIntoBursts(text); // already capped at 4 and deduplicated
  const limitedParts = parts;

  userBotSending.add(chatId);
  try {
    if (shouldDelayFirstReply(user)) {
      const burstDelay = 180000 + Math.random() * 120000; // 3-5 min
      console.log(`⏰ First reply delay: ${Math.round(burstDelay / 60000)} min`);
      await sendTyping(chatId);
      await sleep(burstDelay);
    }
    user.firstReplySent = true;

    for (let i = 0; i < limitedParts.length; i++) {
      const delay = calculateDelay(user, limitedParts[i]);
      // Loop typing indicator every 4s so it stays visible for long messages
      const typingInterval = setInterval(() => sendTyping(chatId), 4000);
      await sendTyping(chatId);
      await sleep(delay);
      clearInterval(typingInterval);

      // ✅ Quote reply chỉ cho tin đầu tiên trong burst
      const shouldQuote = i === 0 && replyToMessageId !== null;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: limitedParts[i],
          ...(shouldQuote ? { reply_parameters: { message_id: replyToMessageId } } : {})
        }),
      });
    }
  } finally {
    userBotSending.delete(chatId);
  }
}

function mentionsLocation(text) {
  const patterns = [
    /i'?m from\s+([a-z]+)/i,
    /from\s+(vietnam|hanoi|saigon|da\s*nang|ho\s*chi\s*minh|usa|america|uk|london|tokyo)/i,
    /live\s+in\s+([a-z]+)/i,
    /living\s+in\s+([a-z]+)/i,
    /based\s+in\s+([a-z]+)/i,
    /in\s+(vietnam|hanoi|saigon|da\s*nang)/i,
  ];
  return patterns.some(p => p.test(text));
}

function applyIntent(user, intentData) {
  if (intentData.windDown) user.wind_down = true;
  if (intentData.mood === "positive") user.relationship_level = Math.min(10, user.relationship_level + 0.5);
  else if (intentData.mood === "negative") user.relationship_level = Math.max(0, user.relationship_level - 0.3);

  // ✅ Sync relationship level + stage to Supabase every 5 messages
  if (user.message_count % 5 === 0) {
    saveFanProfile(user.chatId, {
      relationship_level: user.relationship_level,
      message_count: user.message_count,
      stage: user.stages?.current || 1,
      relationship_state: user.state.relationship_state,
    }).catch(() => {});
  }
}

function decideModel(user, intentData, strategy = null) {
  if (strategy === "ppv_sale") return "grok";
  if (user.stages?.ppv_sale_triggered) return "grok";
  if (intentData.intent === "flirt") return "grok";
  return "openai"; // first_sale, casual_chat, repeat_sale → Claude
}

/* ================== WEBHOOK ================== */
app.post("/webhook", async (req, res) => {
  // ✅ TẠM THỜI: Log file_id ảnh từ channel (xóa sau khi lấy xong file_id)
  if (req.body.channel_post?.photo || req.body.channel_post?.video || req.body.channel_post?.document) {
    const post = req.body.channel_post;
    const caption = post.caption || '';

    // ✅ /register command — format: /register asset_id asset_type [options]
    // Ví dụ: /register food_ramen_01 daily_life
    //         /register flirt_1 tease_selfie ttl:25
    //         /register nails_pink_received confirmation linked_gift:nails_pink
    if (caption.startsWith('/register')) {
      const lines = caption.split('\n');
      const firstLine = lines[0].replace('/register', '').trim().split(/\s+/);
      const assetId = firstLine[0];
      const assetType = firstLine[1];

      if (!assetId || !assetType) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: post.chat.id, text: '❌ Wrong format!\n\nUsage:\n/register asset_id asset_type\nkey:value\nkey:value' }),
        });
        return res.sendStatus(200);
      }

      // ── DEFAULT metadata theo type ──
      const DEFAULTS = {
        daily_life:   { reusable_per_user: false, auto_delete: true,  allowed_states: ['casual','supporter'], requires_support: false, send_delay_required: false },
        confirmation: { reusable_per_user: false, auto_delete: false, allowed_states: ['casual','supporter'], requires_support: true,  send_delay_required: true  },
        gift:         { reusable_per_user: false, auto_delete: false, allowed_states: ['casual','supporter'], requires_support: false, send_delay_required: false },
        tease_selfie: { reusable_per_user: false, auto_delete: true,  allowed_states: ['supporter'],          requires_support: false, send_delay_required: false, ttl: 25 },
        exclusive_selfie: { reusable_per_user: false, auto_delete: true, allowed_states: ['supporter'],       requires_support: true,  send_delay_required: false, ttl: 25 },
        video:        { reusable_per_user: false, auto_delete: true,  allowed_states: ['casual','supporter'], requires_support: false, send_delay_required: false },
      };

      const defaults = DEFAULTS[assetType] || {};

      // ── Parse key:value từ các dòng sau ──
      // Mỗi dòng = 1 cặp key:value → giá trị có thể chứa space thoải mái
      // Ví dụ:
      // /register food_ramen_01 daily_life
      // scene:food
      // desc:Aurelia eating mango bingsu with friends
      const options = { ...defaults };
      const metadata = {};

      // Collect all lines (dòng 2 trở đi) + inline params từ dòng 1
      const allLines = [];
      // Inline params trên dòng 1 (nếu có) — chỉ những param không có space trong value
      firstLine.slice(2).forEach(p => { if (p.includes(':')) allLines.push(p); });
      // Các dòng tiếp theo — full line, value có thể chứa space
      lines.slice(1).forEach(l => { if (l.trim()) allLines.push(l.trim()); });

      allLines.forEach(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) return;
        const k = line.substring(0, colonIdx).trim().toLowerCase();
        const v = line.substring(colonIdx + 1).trim(); // giữ toàn bộ phần sau dấu :

        // Options
        if      (k === 'ttl')          options.ttl = parseInt(v);
        else if (k === 'strategy')     options.strategy_id = parseInt(v);
        else if (k === 'linked_gift')  options.linked_gift_id = v;
        else if (k === 'states')       options.allowed_states = v.split(',');
        else if (k === 'support')      options.requires_support = v === 'true';
        else if (k === 'reusable')     options.reusable_per_user = v === 'true';
        else if (k === 'delete')       options.auto_delete = v === 'true';
        else if (k === 'delay')        metadata.delay_minutes = parseInt(v);
        // Metadata — value giữ nguyên kể cả có space
        else if (k === 'scene')        metadata.scene = v;
        else if (k === 'action')       metadata.action = v;
        else if (k === 'mood')         metadata.mood = v;
        else if (k === 'tease')        metadata.tease_level = v;
        else if (k === 'exclusive')    metadata.exclusivity_level = v;
        else if (k === 'emotion')      metadata.emotion = v;
        else if (k === 'intensity')    metadata.intensity = v;
        else if (k === 'tone')         metadata.tone = v;
        else if (k === 'context')      metadata.context = v;
        else if (k === 'desc')         metadata.description = v; // full text, không bị cắt
        // Fallback
        else metadata[k] = v;
      });

      // ── Lấy file_id ──
      let fileId, mediaType;
      if (post.photo) {
        fileId = post.photo[post.photo.length - 1].file_id;
        mediaType = 'photo';
      } else if (post.video) {
        fileId = post.video.file_id;
        mediaType = 'video';
      } else if (post.document) {
        fileId = post.document.file_id;
        mediaType = 'document';
      }

      if (!fileId) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: post.chat.id, text: '❌ File not found. Please send a photo/video with caption /register' }),
        });
        return res.sendStatus(200);
      }

      const result = await registerAsset({ assetId, assetType, fileId, mediaType, metadata, options });

      // ── Confirm message ──
      const metaLines = Object.entries(metadata).map(([k,v]) => `  ${k}: ${v}`).join('\n');
      const optLines = [
        `  states: ${options.allowed_states?.join(',')}`,
        options.ttl ? `  ttl: ${options.ttl}m` : null,
        options.strategy_id ? `  strategy: ${options.strategy_id}` : null,
        options.linked_gift_id ? `  linked_gift: ${options.linked_gift_id}` : null,
        `  auto_delete: ${options.auto_delete}`,
        `  requires_support: ${options.requires_support}`,
      ].filter(Boolean).join('\n');

      const confirmText = result.ok
        ? `✅ Asset registered!\n\n📦 ${assetId}\n🏷 Type: ${assetType}\n📁 Media: ${mediaType}\n\n📋 Metadata:\n${metaLines || '  (none)'}\n\n⚙️ Options:\n${optLines}`
        : `❌ Failed: ${result.error}`;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: post.chat.id, text: confirmText }),
      });
      return res.sendStatus(200);
    }

    // ── /ppv_preview — Tạo hoặc update PPV product với ảnh preview ──
    // Format:
    // /ppv_preview red_kitty
    // name:Cute little kitty in red ꒦˘∪꒷
    // price:35
    // desc:6 pics exclusive cosplay
    if (caption.startsWith('/ppv_preview')) {
      const lines = caption.split('\n');
      const firstParts = lines[0].replace('/ppv_preview', '').trim().split(/\s+/);
      const productId = firstParts[0];

      if (!productId) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: post.chat.id, text: '❌ Format: /ppv_preview product_id\nname:...\nprice:...\ndesc:...' }),
        });
        return res.sendStatus(200);
      }

      // Parse key:value
      const kv = {};
      lines.slice(1).forEach(l => {
        const ci = l.indexOf(':');
        if (ci === -1) return;
        kv[l.substring(0, ci).trim()] = l.substring(ci + 1).trim();
      });

      // Lấy preview file_id
      const previewFileId = post.photo ? post.photo[post.photo.length - 1].file_id : null;
      if (!previewFileId) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: post.chat.id, text: '❌ Please attach a preview photo!' }),
        });
        return res.sendStatus(200);
      }

      // Upsert vào Supabase
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { error } = await supabase.from('ppv_products').upsert({
        product_id: productId,
        name: kv.name || productId,
        description: kv.desc || kv.description || '',
        theme: kv.theme || kv.tags || '',
        price: parseFloat(kv.price || '0'),
        preview_photo_id: previewFileId,
        delivery_type: 'telegram_album',
        is_active: true,
      }, { onConflict: 'product_id' });

      invalidateCatalogCache();

      const confirmText = error
        ? `❌ Error: ${error.message}`
        : `✅ PPV Product created!\n\n📦 ${productId}\n💰 $${kv.price}\n📝 ${kv.name}\n🖼 Preview: set\n\nNow upload album photos with caption:\n/ppv_photo ${productId}`;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: post.chat.id, text: confirmText }),
      });
      return res.sendStatus(200);
    }

    // ── /ppv_photo — Thêm ảnh vào album của PPV product ──
    // Format: /ppv_photo red_kitty  (hỗ trợ gửi nhiều ảnh cùng lúc)
    if (caption.startsWith('/ppv_photo')) {
      const productId = caption.replace('/ppv_photo', '').trim().split(/\s+/)[0];

      if (!productId) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: post.chat.id, text: '❌ Format: /ppv_photo product_id' }),
        });
        return res.sendStatus(200);
      }

      const photoFileId = post.photo ? post.photo[post.photo.length - 1].file_id
        : post.video ? post.video.file_id
        : null;

      if (!photoFileId) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: post.chat.id, text: '❌ Please attach a photo or video!' }),
        });
        return res.sendStatus(200);
      }

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { data: existing } = await supabase.from('ppv_products').select('photo_ids, name').eq('product_id', productId).single();

      if (!existing) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: post.chat.id, text: `❌ Product "${productId}" does not exist. Create it first with /ppv_preview` }),
        });
        return res.sendStatus(200);
      }

      // ── Media group: gom nhiều ảnh rồi bulk update ──
      const mediaGroupId = post.media_group_id;
      if (mediaGroupId) {
        if (!global._ppvPhotoBuffer) global._ppvPhotoBuffer = {};
        const bufKey = `${productId}_${mediaGroupId}`;

        if (!global._ppvPhotoBuffer[bufKey]) {
          global._ppvPhotoBuffer[bufKey] = { fileIds: [], timer: null, productId, chatId: post.chat.id, albumName: existing.name };
        }
        global._ppvPhotoBuffer[bufKey].fileIds.push(photoFileId);

        // Debounce 2s — đợi ảnh cuối cùng trong group xong mới lưu
        clearTimeout(global._ppvPhotoBuffer[bufKey].timer);
        global._ppvPhotoBuffer[bufKey].timer = setTimeout(async () => {
          const buf = global._ppvPhotoBuffer[bufKey];
          delete global._ppvPhotoBuffer[bufKey];

          const { data: fresh } = await supabase.from('ppv_products').select('photo_ids').eq('product_id', buf.productId).single();
          const newIds = [...(fresh?.photo_ids || []), ...buf.fileIds];
          await supabase.from('ppv_products').update({ photo_ids: newIds, photo_count: newIds.length }).eq('product_id', buf.productId);
          invalidateCatalogCache();

          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: buf.chatId, text: `✅ ${buf.fileIds.length} photos added!\n\n📦 ${buf.productId} — "${buf.albumName}"\n🖼 Total: ${newIds.length} photos` }),
          });
        }, 2000);

        return res.sendStatus(200);
      }

      // ── Single photo ──
      const newIds = [...(existing.photo_ids || []), photoFileId];
      await supabase.from('ppv_products').update({ photo_ids: newIds, photo_count: newIds.length }).eq('product_id', productId);
      invalidateCatalogCache();

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: post.chat.id, text: `✅ Photo added!\n\n📦 ${productId} — "${existing.name}"\n🖼 Total: ${newIds.length} photos` }),
      });
      return res.sendStatus(200);
    }

    // ── Ảnh 2, 3, 4... trong media group (không có caption) ──
    if (post.media_group_id && !caption) {
      if (global._ppvPhotoBuffer) {
        const matchingKey = Object.keys(global._ppvPhotoBuffer).find(k => k.endsWith(`_${post.media_group_id}`));
        if (matchingKey) {
          const photoFileId = post.photo ? post.photo[post.photo.length - 1].file_id
            : post.video ? post.video.file_id : null;
          if (photoFileId) {
            global._ppvPhotoBuffer[matchingKey].fileIds.push(photoFileId);
            clearTimeout(global._ppvPhotoBuffer[matchingKey].timer);
            const buf = global._ppvPhotoBuffer[matchingKey];
            const supabase = (await import('@supabase/supabase-js')).createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
            buf.timer = setTimeout(async () => {
              delete global._ppvPhotoBuffer[matchingKey];
              const { data: fresh } = await supabase.from('ppv_products').select('photo_ids').eq('product_id', buf.productId).single();
              const newIds = [...(fresh?.photo_ids || []), ...buf.fileIds];
              await supabase.from('ppv_products').update({ photo_ids: newIds, photo_count: newIds.length }).eq('product_id', buf.productId);
              invalidateCatalogCache();
              await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: buf.chatId, text: `✅ ${buf.fileIds.length} photos added!\n\n📦 ${buf.productId} — "${buf.albumName}"\n🖼 Total: ${newIds.length} photos` }),
              });
            }, 2000);
          }
          return res.sendStatus(200);
        }
      }
    }

    // Log file_id như cũ (nếu không phải /register)
    const logPhotos = post.photo || [];
    const logFileId = logPhotos.length > 0 ? logPhotos[logPhotos.length - 1].file_id : null;
    const logCaption = post.caption || "(no caption)";
    console.log(`📸 NEW PHOTO file_id: ${logFileId} | caption: ${logCaption}`);
    return res.sendStatus(200);
  }

  // ✅ HANDLE CALLBACK QUERY (nút inline keyboard - PPV store buttons)
  if (req.body.callback_query) {
    const handled = await handleCallbackQuery(req.body.callback_query);
    return res.sendStatus(200);
  }

  const { message } = req.body;
  if (!message) return res.sendStatus(200);

  // ✅ Handle fan sending photo
  if (message.photo && !message.text) {
    const chatId = message.chat.id;
    const fanPhotoFileId = message.photo[message.photo.length - 1].file_id;
    const fanPhotoCaption = message.caption || '';
    // Save photo message to DB
    saveMessage(chatId, {
      role: 'fan',
      content: fanPhotoCaption || '[photo]',
      media_type: 'photo',
      file_id: fanPhotoFileId,
      stage: users[chatId]?.stages?.current || 1,
    }).catch(() => {});
    return res.sendStatus(200);
  }


  // ✅ Handle fan sending voice message — transcribe via Groq Whisper
  if (message.voice || message.audio) {
    const chatId = message.chat.id;
    const fileId = message.voice?.file_id || message.audio?.file_id;
    try {
      const transcript = await transcribeVoice(fileId);
      if (transcript) {
        console.log(`🎙️ Voice transcribed [${chatId}]: "${transcript}"`);
        // Save as text message to DB
        saveMessage(chatId, {
          role: 'fan',
          content: `🎙️ ${transcript}`,
          stage: users[chatId]?.stages?.current || 1,
        }).catch(() => {});
        // Process as normal text message
        const user = await getOrCreateUser(chatId, message.from);
        bufferOrFlushMessage(chatId, transcript, message.message_id);
      } else {
        // Transcription failed — let bot acknowledge
        const user = await getOrCreateUser(chatId, message.from);
        bufferOrFlushMessage(chatId, '[user sent a voice message but it could not be transcribed]', message.message_id);
      }
    } catch (e) {
      console.error(`🎙️ Voice error [${chatId}]:`, e.message);
    }
    return res.sendStatus(200);
  }

  if (!message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;
  const messageId = message.message_id; // ✅ NEW: Lấy message_id để reply

  // Chống duplicate webhook
  const messageKey = `${chatId}_${messageId}`;
  if (processingMessages.has(messageKey)) {
    console.log(`⚠️ Duplicate ignored: ${messageKey}`);
    return res.sendStatus(200);
  }
  processingMessages.add(messageKey);
  setTimeout(() => processingMessages.delete(messageKey), 30000);

  // Admin check
  const adminAction = await handleAdminMessage(message);
  if (adminAction) { console.log(`👨‍💼 Admin action:`, adminAction); return res.sendStatus(200); }

  // Monitoring
  if (text !== "/start") {
    const monitorResult = await logUserMessage(message.from.id, message.from.username, message.from.first_name, text);
    if (monitorResult.needsIntervention) {
      console.log(`🚨 Keyword detected [${monitorResult.keywords.join(", ")}]`);
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "i'll get back to you in a sec~ 💕" }),
      });
      return res.sendStatus(200);
    }
    if (isWaitingAdmin(message.from.id)) {
      console.log(`⏸️ Waiting for admin: ${chatId}`);
      return res.sendStatus(200);
    }
  }

  const user = getUser(chatId);

  /* ========= /shop COMMAND ========= */
  if (text === "/shop") {
    await sendShopHome(chatId);
    return res.sendStatus(200);
  }

  /* ========= /start COMMAND ========= */
  if (text === "/start") {
    console.log(`🚀 /start from ${chatId}`);
    if (!user.first_reply_pending && !user.start_greeting_sent) {
      user.first_reply_pending = true;
      user.first_reply_scheduled_at = Date.now() + 5 * 60 * 1000;
      user.queued_messages = [];
      user.location_mentioned_in_queue = false;
      user.start_timestamp = Date.now();

      user.greeting_timeout = setTimeout(async () => {
        console.log(`\n👋 Sending first greeting to ${chatId}`);
        try {
          await sendUploadPhoto(chatId);
          await sleep(800);
          const memePath = path.join(__dirname, "assets/files/meme/confused_questioning.jpg");
          await sendPhoto(chatId, memePath, { spoiler: false });
          await sleep(2000);
          await sendTyping(chatId);
          await sleep(1500);
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: "Hi" }),
          });
          await sleep(1000);
          await sendTyping(chatId);
          await sleep(1200);
          const followUp = user.location_mentioned_in_queue && user.memoryFacts.location
            ? `oh ${user.memoryFacts.location}! what city?`
            : "where r u from?";
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: followUp }),
          });
          user.start_greeting_sent = true;
          user.first_reply_pending = false;
          user.firstReplySent = true;
          user.greeting_timeout = null;
          if (user.queued_messages.length > 0) user.queued_messages = [];
        } catch (error) {
          console.error(`❌ First greeting error:`, error);
        }
      }, 5 * 60 * 1000);
    }
    return res.sendStatus(200);
  }

  /* ========= QUEUE DURING FIRST DELAY ========= */
  if (user.first_reply_pending) {
    user.queued_messages.push(text);
    if (mentionsLocation(text)) {
      user.location_mentioned_in_queue = true;
      const locationMatch = text.match(/(?:from|in|at|live in|living in|based in)\s+([A-Za-z\s]+?)(?:\s*[,!?.\n]|$)/i);
      if (locationMatch) user.memoryFacts.location = locationMatch[1].trim();
    }
    return res.sendStatus(200);
  }

  if (isTimeWaster(user.state)) { console.log(`⛔ Time waster: ${chatId}`); return res.sendStatus(200); }
  if (user.conversationClosed) return res.sendStatus(200);

  const timeContext = getTimeContext();
  if (timeContext === "deep_night" && (user.conversation_mode === "idle" || user.conversation_mode === "resting")) {
    console.log(`🌙 Deep night idle - not responding`);
    return res.sendStatus(200);
  }

  /* ========= BATCH BUFFER ========= */
  // Gom tin nhắn liên tiếp, flush sau 5s → bot rep tổng hợp 1 lần thay vì rep từng cái
  bufferOrFlushMessage(chatId, text, messageId);
  return res.sendStatus(200);
});

async function processUserMessage(chatId, text, user) {
  // Wait for Supabase profile to finish loading before processing
  // This prevents race condition where bot asks for info it already knows
  if (user.profileLoaded) {
    await Promise.race([
      user.profileLoaded,
      new Promise(r => setTimeout(r, 3000)) // max wait 3s
    ]);
  }

  if (userBotReplying.has(chatId) || userBotSending.has(chatId)) { enqueueMessage(chatId, text); return; }
  if (isTimeWaster(user.state) || user.conversationClosed) return;

  // Nếu user nhắn lại sau khi bye → reset tất cả và tiếp tục
  if (user.conversationClosed) {
    user.conversationClosed = false;
    user.wind_down = false;
    user.wind_down_messages_sent = 0;
    user.bot_initiated_goodbye = false;
    user.bot_sent_final_goodbye = false;
    console.log(`🔄 Conversation reopened for ${chatId}`);
  }

  user.message_count++;
  user.last_active = Date.now();
  if (user.conversation_mode === "idle" || user.conversation_mode === "resting") user.conversation_mode = "chatting";

  onUserMessage(user.state);
  resetWeeklyCounter(user.state);
  initializeStageTracking(user);

  if (!Array.isArray(user.recentMessages)) user.recentMessages = [];
  user.recentMessages.push(`User: ${text}`);
  if (user.recentMessages.length > 20) user.recentMessages.shift();

  // Save user message to DB so dashboard shows it
  saveMessage(chatId, { role: 'fan', content: text, stage: user.stages?.current || 1 })
    .catch(e => console.log('saveMessage fan error:', e.message));

  const { intent: intentData, facts: extractedFacts } = await classifyMessageAndExtractFacts(user, text, user.recentMessages);
  await refreshConversationSummary(user);

  if (extractedFacts && Object.keys(extractedFacts).length > 0) {
    const newFacts = {};
    for (const key in extractedFacts) {
      const newVal = extractedFacts[key];
      const oldVal = user.memoryFacts[key];
      if (!newVal) continue;
      // Always update if empty, or if new value is more specific (longer) than old
      if (!oldVal || newVal.length > oldVal.length) {
        newFacts[key] = newVal;
      }
    }
    if (Object.keys(newFacts).length > 0) {
      Object.assign(user.memoryFacts, newFacts);
      console.log(`💾 Saved facts:`, newFacts);
      // Persist facts to Supabase immediately so dashboard shows them
      saveFanProfile(chatId, {
        name: user.memoryFacts.name || undefined,
        age: user.memoryFacts.age || undefined,
        location: user.memoryFacts.location || undefined,
        job: user.memoryFacts.job || undefined,
        message_count: user.message_count,
        stage: user.stages?.current || 1,
        relationship_state: user.state.relationship_state,
        relationship_level: user.relationship_level,
      }).catch(e => console.log('saveFanProfile facts error:', e.message));
    }
  }

  // ✅ NEW: Update context
  updateConversationContext(user, text, "user", intentData);

  if (intentData.intent === "flirt") user.conversation_mode = "flirting";
  else if (intentData.intent === "normal") user.conversation_mode = "chatting";

  applyIntent(user, intentData);

  // Detect stage transitions (including ppv_sale)
  const stageTransition = detectStageTransition(user, text);
  if (stageTransition) {
    console.log(`📍 Stage transition: ${stageTransition.trigger} — ${stageTransition.reason}`);
    // If ppv_sale triggered by user asking for photos, override strategy
    if (stageTransition.trigger === "ppv_sale" || stageTransition.trigger === "ppv_sale_mild") {
      // Will be handled in strategy selection below via ppv_sale_triggered flag
    }
  }

  // Log current stage every message
  console.log(`📊 [${chatId}] Stage: ${user.stages?.current || 1} | Mood: ${intentData.mood} | Msgs: ${user.message_count} | Weekly sales: ${user.state.weeklySaleAttempts || 0}/3`);

  // Detect "how about u / and u / what about u" — inject explicit hint so AI understands
  let textForAI = text;
  const isReciprocalQ = /\b(how about u|how about you|what about u|what about you|and u\?|and you\?|ur turn|your turn)\b/i.test(text)
    || /^(u\?|you\?|and u\?|and you\?|ur\?)$/i.test(text.trim())
    || /^(what|how) about (u|you|ur)\??$/i.test(text.trim());

  if (isReciprocalQ && user.recentMessages.length >= 2) {
    // Find what bot last asked
    const lastBotMsg = [...user.recentMessages].reverse().find(m => m.startsWith("Aurelia:"));
    const lastUserMsg = [...user.recentMessages].reverse().find(m => m.startsWith("User:") && !/(how about|and u|what about)/i.test(m));
    if (lastBotMsg) {
      const botQ = lastBotMsg.replace(/^Aurelia:\s*/, "").trim();
      const userAnswer = lastUserMsg ? lastUserMsg.replace(/^User:\s*/, "").trim() : null;
      const hint = userAnswer
        ? `[CONTEXT: User answered "${userAnswer}" to your question "${botQ}". Now they're asking you the same question back. Answer about YOURSELF — what YOU do for that topic.]`
        : `[CONTEXT: User is asking you the same question you just asked them: "${botQ}". Answer about YOURSELF.]`;
      textForAI = `${hint}\n${text}`;
      console.log(`🔄 Reciprocal question detected — injecting context for ${chatId}`);
    }
  }

  // ===== STRATEGY SELECTION =====
  let currentStrategy = null;
  let selectedStrategyObj = null;

  const timingCheck = shouldAttemptSaleByTiming(user);
  const contextCheck = isConversationSuitableForSale(user, intentData, user.recentMessages);

  // Force sale bypasses context check (mood/topic) but never bypasses negative mood
  const canAttemptSale = timingCheck.allow && (contextCheck.suitable || timingCheck.force);
  const isForced = timingCheck.force && intentData.mood !== "negative";

  // ── MODE ROUTING ──
  // stranger  → 1st_sale (stage 1-6, chỉ 1 lần duy nhất)
  // casual / supporter → casual_chat (default), repeat_sale hoặc ppv_sale khi timing pass

  if (isStranger(user.state) && !user.first_sale_done) {
    // User mới — luôn 1st_sale, chỉ 1 lần duy nhất
    currentStrategy = "first_sale";
    console.log(`🌱 1st sale — stranger user`);
  } else {
    // ppv_sale ưu tiên cao nhất — user flirty hoặc ask for photos
    if (user.stages?.ppv_sale_triggered || detectAskForPhotos(text)) {
      currentStrategy = "ppv_sale";
      console.log(`🔥 PPV sale triggered`);
    } else if (canAttemptSale) {
      // Timing check pass → repeat_sale
      selectedStrategyObj = selectRepeatStrategy(user, intentData, user.recentMessages);
      if (selectedStrategyObj?.strategy) {
        currentStrategy = "repeat_sale";
        const label = isForced ? "🔴 FORCED" : "🎯";
        console.log(`${label} Repeat sale: ${selectedStrategyObj.strategy} | ${timingCheck.reason}`);
      } else {
        currentStrategy = "casual_chat";
        console.log(`💬 Casual chat (strategy blocked: ${selectedStrategyObj?.reason})`);
      }
    } else {
      // Timing check failed → casual_chat (default mode)
      currentStrategy = "casual_chat";
      console.log(`💬 Casual chat | ${timingCheck.allow ? contextCheck.reason : timingCheck.reason}`);
    }
  }

  if (currentStrategy && currentStrategy !== "casual_chat") {
    onSaleAttempt(user.state);
  }

  const modelChoice = decideModel(user, intentData, currentStrategy);

  userBotReplying.add(chatId);
  let replyText;
  try {
    if (modelChoice === "openai") {
      replyText = await callOpenAI(buildPreciseOpenAIPrompt(user, currentStrategy), textForAI);
    } else {
      replyText = await callGrok(buildPreciseGrokPrompt(user, currentStrategy, selectedStrategyObj), await buildContextPrompt(user, currentStrategy, getTimeContext()), textForAI);
    }
  } catch (err) {
    console.error("❌ Queue AI failed:", err.message);
    userBotReplying.delete(chatId);
    return;
  }

  const assetMarkers = parseAssetMarkers(replyText);
  // Strip [STICKER:...] markers — sticker system removed
  const cleanReplyText = assetMarkers.cleanResponse.replace(/\[STICKER:\s*\w+\s*\]/gi, "").replace(/  +/g, " ").trim();
  userBotReplying.delete(chatId);

  // Quote-reply to the last user message
  const quoteId = user.lastIncomingMessageId || null;
  await sendBurstReplies(user, chatId, cleanReplyText, quoteId);
  user.lastIncomingMessageId = null; // reset after use

  // Send asset if AI included [SEND_ASSET:...] marker
  if (assetMarkers.hasAsset && !user.wind_down) {
    try {
      await sleep(1500);
      const assetData = getAssetToSend(assetMarkers, 0, chatId);
      if (assetData) {
        const { asset, shouldScheduleConfirmation, shouldSendImage } = assetData;
        if (shouldSendImage) {
          await sendUploadPhoto(chatId);
          await sleep(800);
          const sendResult = await sendAsset(chatId, asset);
          if (sendResult?.ok) {
            console.log(`✅ Asset sent: ${asset.assetId}`);
            // Save asset to DB so it appears in dashboard
            saveMessage(chatId, { role: "bot", content: "[photo]", media_type: "photo", file_id: asset.fileId || null, stage: user.stages?.current || 1 })
              .catch(() => {});
          } else {
            console.error(`❌ Asset failed: ${asset.assetId}`);
          }
        }
        if (shouldScheduleConfirmation) {
          user.pending_gift_id = asset.assetId;
          user.pending_gift_asset = asset;
          console.log(`📦 Gift pending payment: ${asset.assetId}`);
        }
      }
    } catch (e) {
      console.error("Asset send error:", e.message);
    }
  }

  // Save delivered file_ids (e.g. from exclusive selfie)
  if (assetMarkers.deliveredFileIds?.length > 0) {
    for (const fid of assetMarkers.deliveredFileIds) {
      saveMessage(chatId, { role: "bot", content: "[photo]", media_type: "photo", file_id: fid, stage: user.stages?.current || 1 })
        .catch(() => {});
    }
  }

  // Handle specific PPV marker: bot outputs [SEND:ppv_XXXX] with exact product ID
  const specificPPVMatch = replyText.match(/\[SEND:ppv_([\w]+)\]/);
  if (specificPPVMatch && specificPPVMatch[1] !== 'heavy') {
    const specificId = specificPPVMatch[1];
    try {
      const catalog = await getCatalog();
      const sentIds = user.ppv_sent || [];
      if (catalog[specificId] && !sentIds.includes(specificId)) {
        await sleep(1500);
        await sendAlbumPreview(chatId, specificId);
        user.ppv_sent = [...sentIds, specificId];
        saveFanProfile(chatId, { ppv_sent: user.ppv_sent }).catch(() => {});
        console.log(`📸 Specific PPV sent to ${chatId}: ${specificId}`);
        onSaleAttempt(user.state);
      } else if (sentIds.includes(specificId)) {
        // Already sent — pick next available
        const availableIds = Object.keys(catalog).filter(id => !sentIds.includes(id));
        if (availableIds.length > 0) {
          await sleep(1500);
          await sendAlbumPreview(chatId, availableIds[0]);
          user.ppv_sent = [...sentIds, availableIds[0]];
          saveFanProfile(chatId, { ppv_sent: user.ppv_sent }).catch(() => {});
          console.log(`📸 Fallback PPV sent to ${chatId}: ${availableIds[0]} (${specificId} already sent)`);
          onSaleAttempt(user.state);
        }
      }
    } catch(e) { console.error('Specific PPV error:', e.message); }
  }

  // If ppv_sale triggered — send PPV album preview after bot reply
  if (currentStrategy === "ppv_sale" && user.stages?.ppv_sale_triggered) {
    try {
      await sleep(2000);
      const catalog = await getCatalog();
      const allIds = Object.keys(catalog || {});

      if (allIds.length > 0) {
        // Filter out PPVs already sent to this user
        const sentIds = user.ppv_sent || [];
        const availableIds = allIds.filter(id => !sentIds.includes(id));

        if (availableIds.length === 0) {
          console.log(`⚠️ All PPVs already sent to ${chatId} — skipping`);
          user.stages.ppv_sale_triggered = false;
        } else {
          // Smart selection: match PPV theme to conversation context
          const recentContext = (user.recentMessages || []).slice(-10).join(' ').toLowerCase();
          let bestMatch = null;
          let bestScore = -1;

          for (const id of availableIds) {
            const product = catalog[id];
            const theme = (product.theme || product.description || '').toLowerCase();
            if (!theme) continue;
            const themeWords = theme.split(/[,\s]+/).filter(w => w.length > 2);
            const score = themeWords.filter(w => recentContext.includes(w)).length;
            if (score > bestScore) { bestScore = score; bestMatch = id; }
          }

          // Fallback to first available if no theme match
          const albumToOffer = bestMatch || availableIds[0];

          await sendAlbumPreview(chatId, albumToOffer);
          console.log(`📸 PPV preview sent to ${chatId}: ${albumToOffer} (score: ${bestScore})`);

          // Track sent PPV
          user.ppv_sent = [...sentIds, albumToOffer];

          // Persist ppv_sent to Supabase
          saveFanProfile(chatId, { ppv_sent: user.ppv_sent }).catch(() => {});

          user.stages.ppv_sale_triggered = false;
          updateStage(user, 6, "PPV sale completed — PPV preview sent");
          onSaleAttempt(user.state);
        }
      } else {
        console.log(`⚠️ No PPV products in catalog for ${chatId}`);
      }
    } catch (e) {
      console.error("PPV preview error:", e.message);
    }
  }

  await logBotMessage(chatId, cleanReplyText);
  saveMessage(chatId, { role: "bot", content: cleanReplyText, stage: user.stages?.current || 1 })
    .catch(e => console.log("saveMessage bot error:", e.message));

  user.recentMessages.push(`Aurelia: ${cleanReplyText}`);
  if (user.recentMessages.length > 12) user.recentMessages.shift();

  // Mark first_sale_done when stage 6 is reached — prevent re-triggering 1st sale
  if (currentStrategy === "first_sale" && user.stages?.current >= 6 && !user.first_sale_done) {
    user.first_sale_done = true;
    console.log(`✅ 1st sale completed for ${chatId} — locked`);
  }

  // Track if kofi link has been sent — prevent bot asking "wanna see photos?" again
  if (/ko-fi\.com|ko-fi link/i.test(cleanReplyText)) {
    user.kofi_link_sent = true;
    console.log(`🔗 Ko-fi link sent to ${chatId} — blocking repeat photo asks`);
  }

  updateConversationContext(user, cleanReplyText, "bot");

  // Detect bot chủ động propose goodbye (wind_down final hoặc post-sale)
  const botProposesGoodbye = /(i have to go|i gotta go|gotta sleep|going to bed|have class|need to rest|gonna sleep|going to sleep|talk to u (tmr|tomorrow|later)|talk (tmr|tomorrow|later))/i.test(cleanReplyText);
  if (botProposesGoodbye && !user.bot_initiated_goodbye) {
    user.bot_initiated_goodbye = true;
    user.bot_sent_final_goodbye = false;
    console.log(`🌙 Bot proposed goodbye for ${chatId} — waiting for user response`);
  }

  // Nếu bot đã propose goodbye và đây là reply tiếp theo → đây là final message
  if (user.bot_initiated_goodbye && !botProposesGoodbye && !user.bot_sent_final_goodbye) {
    user.bot_sent_final_goodbye = true;
  }

  // Đóng hội thoại
  if (detectMutualGoodbye(user, cleanReplyText, text)) {
    user.conversationClosed = true;
    user.conversation_mode = "idle";
    console.log(`👋 Conversation closed for ${chatId}`);
  }

  console.log(`✅ Queue processed for ${chatId}`);
  setTimeout(() => processNextInQueue(chatId), 500);
}

/* ================== CONFIRMATION CHECKER ================== */
async function checkAndSendPendingConfirmations() {
  for (const chatId in users) {
    const pending = getPendingConfirmations(chatId);
    for (const confirmation of pending) {
      try {
        await sendUploadPhoto(chatId);
        await sleep(1000);
        const result = await sendAsset(chatId, confirmation.asset);
        if (result?.ok) {
          console.log(`✅ Sent confirmation to ${chatId}`);
          // Auto-delete được xử lý bên trong telegramAssets.js
          await sendBurstReplies(users[chatId], chatId, "Look what I got! 💕 Thank you so much~");
    // ✅ Sync sale success to Supabase
    const u = users[chatId];
    if (u) saveFanProfile(chatId, {
      total_sale_attempts: (u.state.totalSales || 0),
      total_sale_success: (u.state.successfulSales || 0),
      total_sale_fail: (u.state.totalSales || 0) - (u.state.successfulSales || 0),
    }).catch(() => {});
        }
      } catch (error) {
        console.error(`❌ Confirmation error for ${chatId}:`, error);
      }
    }
  }
}
setInterval(checkAndSendPendingConfirmations, 5 * 60 * 1000);

/* ================== SERVER ================== */


// Helper for dashboard API to send messages
async function sendTelegramMessage(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) throw new Error(`Telegram error: ${res.status}`);
  return res.json();
}


// ============================================================
// DASHBOARD APIs
// ============================================================


// GET photo URL from Telegram file_id (for dashboard display)
app.get("/api/photo/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const token = process.env.TELEGRAM_AURELIABOT_TOKEN;
    const r = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const data = await r.json();
    if (!data.ok) return res.status(404).json({ error: "File not found" });
    const url = `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
    res.json({ url });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET all fan profiles
app.get("/api/fans", async (req, res) => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data } = await sb.from("fan_profiles").select("*").order("last_active", { ascending: false }).limit(100);
  res.json(data || []);
});

// GET messages for a fan
app.get("/api/messages/:chatId", async (req, res) => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data } = await sb.from("messages").select("*")
    .eq("chat_id", req.params.chatId)
    .order("created_at", { ascending: true })
    .limit(200);
  res.json(data || []);
});

// GET memories for a fan
app.get("/api/memories/:chatId", async (req, res) => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data } = await sb.from("fan_memories").select("*")
    .eq("chat_id", req.params.chatId)
    .order("importance", { ascending: false })
    .limit(30);
  res.json(data || []);
});

// GET purchases
app.get("/api/purchases", async (req, res) => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const q = sb.from("purchases").select("*").order("created_at", { ascending: false }).limit(100);
  if (req.query.chat_id) q.eq("chat_id", req.query.chat_id);
  const { data } = await q;
  res.json(data || []);
});


// POST admin send photo (Human Takeover)
app.post("/api/send-photo", async (req, res) => {
  try {
    // Parse multipart form data using express built-in
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const boundary = req.headers['content-type'].split('boundary=')[1];
        const body = Buffer.concat(chunks);
        const bodyStr = body.toString('binary');

        // Extract chatId and caption
        const chatIdMatch = bodyStr.match(/name="chatId"\r\n\r\n([^\r\n]+)/);
        const captionMatch = bodyStr.match(/name="caption"\r\n\r\n([^\r\n]+)/);
        const chatId = chatIdMatch ? chatIdMatch[1].trim() : null;
        const caption = captionMatch ? captionMatch[1].trim() : '';

        if (!chatId) return res.status(400).json({ error: 'Missing chatId' });

        // Extract photo binary
        const photoStart = bodyStr.indexOf('\r\n\r\n', bodyStr.indexOf('name="photo"')) + 4;
        const photoEnd = bodyStr.lastIndexOf(`--${boundary}`);
        const photoBinary = body.slice(
          Buffer.byteLength(bodyStr.substring(0, photoStart), 'binary'),
          Buffer.byteLength(bodyStr.substring(0, photoEnd - 2), 'binary')
        );

        // Send to Telegram via multipart
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('photo', photoBinary, { filename: 'photo.jpg', contentType: 'image/jpeg' });
        if (caption) form.append('caption', caption);

        const tgRes = await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendPhoto`,
          { method: 'POST', body: form, headers: form.getHeaders() }
        );
        const tgData = await tgRes.json();
        if (!tgData.ok) return res.status(500).json({ error: tgData.description });

        // Save to messages DB
        const fileId = tgData.result?.photo?.slice(-1)[0]?.file_id;
        await saveMessage(parseInt(chatId), {
          role: 'admin',
          content: caption || '[photo]',
          media_type: 'photo',
          file_id: fileId || null,
        });

        res.json({ ok: true });
      } catch(e) {
        res.status(500).json({ error: e.message });
      }
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST admin send message (Human Takeover)
app.post("/api/send", async (req, res) => {
  const { chatId, text } = req.body;
  if (!chatId || !text) return res.status(400).json({ error: "Missing chatId or text" });
  try {
    await sendTelegramMessage(chatId, text);
    await saveMessage(chatId, { role: "admin", content: text, stage: null });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST toggle takeover
app.post("/api/takeover", async (req, res) => {
  const { chatId, active } = req.body;
  if (!chatId) return res.status(400).json({ error: "Missing chatId" });
  await setTakeover(chatId, active);
  res.json({ ok: true, chatId, active });
});



// ============================================================
// ADMIN UPDATE FAN STATE — dùng khi Human Takeover
// POST /api/admin-update-fan { chatId, relationship_state?, stage?, add_spent?, has_purchased?, purchase_note? }
// ============================================================
app.post("/api/admin-update-fan", async (req, res) => {
  const { chatId, relationship_state, stage, add_spent, has_purchased, purchase_note, name, age, location, job } = req.body;
  if (!chatId) return res.status(400).json({ error: "Missing chatId" });

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 1. Build fan_profiles update
    const profileUpdate = { last_active: new Date().toISOString() };
    if (relationship_state) profileUpdate.relationship_state = relationship_state;
    if (stage) profileUpdate.stage = stage;
    if (has_purchased) profileUpdate.has_purchased = true;
    if (name) profileUpdate.name = name;
    if (age) profileUpdate.age = age;
    if (location) profileUpdate.location = location;
    if (job) profileUpdate.job = job;

    // If adding spent amount — get current first
    if (add_spent > 0) {
      const { data: current } = await sb.from("fan_profiles").select("total_spent, purchase_count").eq("chat_id", chatId).single();
      profileUpdate.total_spent = (current?.total_spent || 0) + add_spent;
      profileUpdate.purchase_count = (current?.purchase_count || 0) + 1;
      profileUpdate.last_purchase_at = new Date().toISOString();
    }

    await sb.from("fan_profiles").update(profileUpdate).eq("chat_id", chatId);

    // 2. Log purchase if amount provided
    if (add_spent > 0) {
      await sb.from("purchases").insert({
        chat_id: chatId,
        amount: add_spent,
        item: purchase_note || "manual entry (human takeover)",
        created_at: new Date().toISOString(),
      });
    }

    // 3. Sync to in-memory user if loaded
    const user = users[chatId];
    if (user) {
      if (relationship_state) user.state.relationship_state = relationship_state;
      if (stage) { if (!user.stages) user.stages = {}; user.stages.current = stage; }
      if (add_spent > 0) {
        user.state.total_spent = (user.state.total_spent || 0) + add_spent;
        user.state.purchase_count = (user.state.purchase_count || 0) + 1;
        user.state.has_purchased = true;
      }
      if (has_purchased) user.state.has_purchased = true;
      if (!user.memoryFacts) user.memoryFacts = {};
      if (name) user.memoryFacts.name = name;
      if (age) user.memoryFacts.age = age;
      if (location) user.memoryFacts.location = location;
      if (job) user.memoryFacts.job = job;
      console.log(`⚙️ Admin updated fan ${chatId}:`, { relationship_state, stage, add_spent });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("admin-update-fan error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// RESET TEST DATA — xóa data của 1 chatId hoặc toàn bộ trước ngày nhất định
// POST /api/reset-test  { secret, chatId? }         → xóa 1 user
// POST /api/reset-test  { secret, beforeDate? }     → xóa tất cả trước ngày đó
// POST /api/reset-test  { secret, all: true }       → xóa TOÀN BỘ (cẩn thận!)
// ============================================================
app.post("/api/reset-test", async (req, res) => {
  const { secret, chatId, beforeDate, all } = req.body;

  // Simple secret check — set ADMIN_SECRET in Render env vars
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "aurelia-admin-2024";
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const tables = ["messages", "fan_memories", "conversation_summaries", "purchases", "fan_profiles", "takeovers"];
  const results = {};

  try {
    for (const table of tables) {
      let query = sb.from(table).delete();

      if (chatId) {
        // Xóa 1 user cụ thể
        query = query.eq("chat_id", chatId);
      } else if (beforeDate) {
        // Xóa tất cả record trước ngày nhất định (ISO string, e.g. "2025-03-01")
        query = query.lt("created_at", beforeDate);
      } else if (all) {
        // Xóa toàn bộ — dùng neq để bypass Supabase require filter
        query = query.neq("chat_id", "__never__");
      } else {
        return res.status(400).json({ error: "Must provide chatId, beforeDate, or all:true" });
      }

      const { error, count } = await query;
      results[table] = error ? `error: ${error.message}` : `deleted`;
    }

    // Also clear in-memory users if chatId specified
    if (chatId && users[chatId]) {
      delete users[chatId];
      console.log(`🗑️ Cleared in-memory user: ${chatId}`);
    } else if (all) {
      Object.keys(users).forEach(k => delete users[k]);
      console.log("🗑️ Cleared ALL in-memory users");
    }

    console.log("🗑️ Reset test data:", results);
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET stats
app.get("/api/stats", async (req, res) => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const [fans, purchases, memories] = await Promise.all([
    sb.from("fan_profiles").select("*", { count: "exact", head: false }),
    sb.from("purchases").select("amount, created_at"),
    sb.from("fan_memories").select("id", { count: "exact", head: true }),
  ]);
  const totalRevenue = (purchases.data || []).reduce((s, p) => s + (p.amount || 0), 0);
  const supporters = (fans.data || []).filter(f => f.relationship_state === "supporter").length;
  const totalSaleSuccess = (fans.data || []).reduce((s, f) => s + (f.total_sale_success || 0), 0);
  const totalSaleFail = (fans.data || []).reduce((s, f) => s + (f.total_sale_fail || 0), 0);
  const totalSaleAttempts = totalSaleSuccess + totalSaleFail;
  const conversionRate = totalSaleAttempts > 0 ? ((totalSaleSuccess / totalSaleAttempts) * 100).toFixed(1) : "0.0";
  res.json({
    totalFans: fans.data?.length || 0,
    totalRevenue: totalRevenue.toFixed(2),
    supporters,
    totalMemories: memories.count || 0,
    totalPurchases: purchases.data?.length || 0,
    totalSaleSuccess,
    totalSaleFail,
    totalSaleAttempts,
    conversionRate,
  });
});


// ============================================================
// DASHBOARD ROUTE
// ============================================================

app.get("/dashboard", (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
    let html = readFileSync(path.join(__dirname, "dashboard.html"), "utf8");
    html = html
      .replace("const SUPABASE_URL = window.SUPABASE_URL || '';", `const SUPABASE_URL = '${supabaseUrl}';`)
      .replace("const SUPABASE_KEY = window.SUPABASE_KEY || ''; // use publishable key (anon)", `const SUPABASE_KEY = '${supabaseKey}';`);
    res.send(html);
  } catch(e) {
    res.status(500).send('Dashboard error: ' + e.message);
  }
});

app.listen(port, () => console.log(`🌸 Aurelia running on port ${port}`));

export { buildContextPrompt, buildOpenAIPrompt, buildGrokPrompt };
