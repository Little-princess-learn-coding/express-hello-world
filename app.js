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

import STAGE_5A_PROMPT from "./prompts/stage5A.content.js";
import FIRST_SALE_GUIDE from "./prompts/1st.saleGuide.js";
import REPEATED_SALE_GUIDE from "./prompts/repeated_sale.js";
import SYSTEM_PROMPT_BASE from "./prompts/systemPrompt.js";

import {
  parseAssetMarkers,
  getAssetToSend,
  getPendingConfirmations,
  scheduleConfirmation
} from "./assets/assetEngine.js";

import {
  sendAsset,
  sendUploadPhoto,
  sendPhoto
} from "./assets/telegramAssets.js";

import { logUserMessage, logBotMessage, handleAdminMessage } from "./user_monitoring/monitoringSystem.js";
import { isWaitingAdmin } from "./user_monitoring/monitoringDb.js";

import path from "path";
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
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
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
    positive: "=== MOOD GUIDE ===\nFan is in a GOOD mood 😊 — match their energy, be playful and warm.",
    neutral: "=== MOOD GUIDE ===\nFan seems NEUTRAL — keep it natural, don't force excitement.",
    negative: "=== MOOD GUIDE ===\nFan seems DOWN 🥺 — be gentle, show care. Skip sales. Ask what's wrong briefly.",
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

function shouldReplyToMessage(user, text) {
  if (/\?$/.test(text.trim())) return true;
  if (/(aurelia|you|ur|your)/i.test(text)) return true;
  if (user.message_count <= 2) return true;
  if (text.trim().split(" ").length <= 2) return false;
  return Math.random() < 0.4;
}

/* ================== STAGE SYSTEM ================== */

function detectFastLane(text) {
  return /(cosplay|cosplayer|game|gamer|hobby|anime|what do you like|what are you into)/i.test(text);
}

function detectAskForPhotos(text) {
  return /(see.*photo|see.*pic|your photo|your pics|show me|can i see|your cosplay)/i.test(text);
}

function detectEmotionalSupport(text) {
  return /(yes|of course|i would|sure|i['']ll be your fan|i support you)/i.test(text);
}

function botAskedForSupport(text) {
  return /(ko-fi|support me|buy my|help me saving|support my)/i.test(text);
}

// ❌ detectSaleSuccess đã bị xóa
// ✅ Thanh toán giờ được xác nhận tự động qua PayPal webhook + NOWPayments webhook
// → ppvStore.js xử lý và gọi deliverContent() + onSaleSuccess() tự động

function detectCosplayQuestion(text) {
  return /(cosplay|costume|character|anime character|who do you cosplay)/i.test(text);
}

function detectHobbyQuestion(text) {
  return /(hobby|hobbies|interest|interests|what do you do|free time|like to do)/i.test(text);
}

function detectFlirtyExcessive(text) {
  const flirtyKeywords = ["sexy", "hot", "beautiful pics", "send nudes", "show me more", "you're hot", "so sexy", "gorgeous", "stunning pics", "wanna see you", "show yourself", "babe", "baby", "cutie"];
  const lower = text.toLowerCase();
  return flirtyKeywords.some(k => lower.includes(k));
}

function initializeStageTracking(user) {
  if (!user.stages) {
    user.stages = { current: 1, completed: [], skipped: [], stage5A_triggered: false };
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
    user.stages.stage5A_triggered = true;
    return { trigger: "stage_5A", newStage: "5A", reason: "User flirty + asking for photos" };
  }
  if (detectAskForPhotos(text) && currentStage < 5) {
    user.stages.stage5A_triggered = true;
    return { trigger: "stage_5A_mild", newStage: "5A", reason: "User asking for photos" };
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
  if (currentStage === 1 && user.message_count >= 4) {
    updateStage(user, 2, "Natural progression");
    return { trigger: "natural_stage_2", newStage: 2, reason: "Message count threshold" };
  }
  if (currentStage === 2 && user.message_count >= 8) { updateStage(user, 3, "Natural progression"); return null; }
  if (currentStage === 3 && user.message_count >= 12) { updateStage(user, 4, "Natural progression"); return null; }
  return null;
}

function getStageInstructions(user) {
  const stage = user.stages?.current || 1;
  return `${FIRST_SALE_GUIDE}\n\nCurrent Stage: ${stage}\nFocus on Stage ${stage} instructions above.`;
}

/* ================== REPEAT SALE STRATEGY ================== */

function selectRepeatStrategy(user, intentData, recentMessages) {
  const conversationText = recentMessages.slice(-6).join(" ").toLowerCase();

  if (/(another girl|other cosplayer|she is|her cosplay|that girl|other girls|another woman)/i.test(conversationText))
    return { strategy: "jealousy", confidence: 0.95, reason: "User mentioned another girl/cosplayer", canBypass: true };

  if (intentData.intent === "flirt" && intentData.mood === "positive" &&
    /(show me|see you|more pics|more photos|spicy|sexy|hot|naughty|send me|your body)/i.test(conversationText))
    return { strategy: "exclusive", confidence: 0.9, reason: "User flirty and wants exclusive content", canBypass: true };

  if (/(imagine|what if|pretend|roleplay|fantasy|let's say|let me be|you be my)/i.test(conversationText))
    return { strategy: "roleplay", confidence: 0.85, reason: "User initiated roleplay/fantasy", canBypass: false };

  if (intentData.mood === "neutral" && /(how are you|you okay|feeling|take care|rest|tired|sick)/i.test(conversationText))
    return { strategy: "unwell", confidence: 0.75, reason: "User showing care/concern", canBypass: false };

  if (/(your cosplay|new photos|new pics|what character|next project|album|your work)/i.test(conversationText))
    return { strategy: "album", confidence: 0.8, reason: "User interested in cosplay work", canBypass: false };

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
  if (now - user.state.weeklyResetAt >= weekMs) {
    user.state.weeklySaleAttempts = 0;
    user.state.weeklyResetAt = now;
  }

  if (user.state.weeklySaleAttempts >= 3)
    return { allow: false, reason: `Weekly limit reached (${user.state.weeklySaleAttempts}/3)` };

  if (user.state.lastSaleAt) {
    const hoursSince = (now - user.state.lastSaleAt) / (1000 * 60 * 60);
    const minCooldown = isSupporter(user.state) ? 24 : 48;
    if (hoursSince < minCooldown)
      return { allow: false, reason: `Cooldown active (${Math.round(minCooldown - hoursSince)}h remaining)` };
  }

  const daysSinceReset = (now - user.state.weeklyResetAt) / (1000 * 60 * 60 * 24);
  if (daysSinceReset >= 6 && user.state.weeklySaleAttempts === 0)
    return { allow: true, force: true, reason: "Weekly minimum requirement" };

  return { allow: true, reason: "Timing check passed" };
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

async function callOpenAI(systemPrompt, userMessage) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });
  const data = await response.json();
  if (!data.choices || !data.choices[0]) throw new Error("OpenAI returned no choices");
  return data.choices[0].message.content;
}

async function callGrok(systemPrompt, contextPrompt, userMessage) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model: "grok-2-latest",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: contextPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.95,
      max_tokens: 500,
    }),
  });
  const data = await response.json();
  return data.choices[0].message.content;
}

async function classifyImage(imageUrl) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model: "grok-2-vision-latest",
      messages: [
        { role: "system", content: "You classify photos sent to a girlfriend-vibe chatbot. Be conservative." },
        { role: "user", content: [{ type: "text", text: "Classify into ONE: selfie, body_flex, pet, food, scenery, meme, other. Reply ONLY with category name." }, { type: "image_url", image_url: imageUrl }] }
      ],
      temperature: 0,
      max_tokens: 10,
    }),
  });
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function classifyMessageAndExtractFacts(user, userMessage, recentMessages) {
  const conversationContext = recentMessages.slice(-12).join("\n");
  const systemPrompt = `You are an analyzer for a cosplayer chatbot named Aurelia.
Analyze the user message and return TWO things in ONE JSON response:
1. INTENT: intent ("flirt"|"normal"), mood ("positive"|"neutral"|"negative"), saleResponse ("yes"|"no"|"maybe"|"none"), windDown (bool)
2. FACTS: name, age, location (city/country only), job — only if clearly mentioned
Respond ONLY in this exact JSON (no extra text):
{"intent":"flirt or normal","mood":"positive or neutral or negative","saleResponse":"yes or no or maybe or none","windDown":false,"facts":{}}`;

  const userPrompt = `Recent conversation:\n${conversationContext}\n\nCurrent message: "${userMessage}"\nSale status: ${user.has_asked_support}, mode: ${user.conversation_mode}`;

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

function buildContextPrompt(user, strategy, timeContext) {
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
Time: ${timeContext}
Mode: ${user.conversation_mode}

=== PAYMENT LINKS ===
Ko-fi: ${KOFI_LINK}
PayPal: @${PAYPAL_USERNAME} or ${PAYPAL_LINK}

PAYMENT RULES:
- First sale (stranger): Ko-fi ONLY → "${KOFI_LINK} 💕"
- Repeat sale (casual/supporter): PayPal → "@${PAYPAL_USERNAME}"

=== RECENT MESSAGES ===
${user.recentMessages.slice(-10).join("\n")}

=== STRATEGY ===
${strategy || "normal_conversation"}
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
  if (strategy === "user_initiated_sale" || strategy === "stage_5A") {
    promptContent = STAGE_5A_PROMPT;
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
Keep responses natural and flirty.`;
}

/* ================== USER STATE ================== */
const users = {};
const processingMessages = new Set();
const userBotReplying = new Set();
const userBotSending = new Set();
const userMessageQueue = new Map();

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

function getUser(chatId) {
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
      // ✅ NEW: Conversation context for memory/mood/topic tracking
      conversationContext: createConversationContext(),
      firstReplySent: false,
      conversationClosed: false,
      has_seen_content: false,
      emotional_ready: false,
      has_asked_support: false,
      start_greeting_scheduled: false,
      start_greeting_sent: false,
      stages: { current: 1, completed: [], skipped: [], stage5A_triggered: false },
      lastIntentData: null,
    };
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
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 7 * 60 * 60 * 1000);
}

function getTimeContext() {
  const hour = getVietnamTime().getHours();
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  if (hour >= 22 || hour < 2) return "night";
  return "deep_night";
}

function calculateDelay(user, replyText) {
  const baseDelay = { stranger: 1200, casual: 800, supporter: 500 }[user.state.relationship_state] || 1000;
  const perChar = 25;
  const random = Math.random() * 500;
  return Math.min(baseDelay + replyText.length * perChar + random, 6000);
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
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

function splitIntoBursts(text) {
  return text.split(/\n{2,}|(?<=[.!?])\s+/).map(t => t.trim()).filter(Boolean);
}

// ✅ UPDATED: Thêm replyToMessageId parameter
async function sendBurstReplies(user, chatId, text, replyToMessageId = null) {
  const parts = splitIntoBursts(text);
  const maxMessages = Math.floor(Math.random() * 3) + 1;
  let limitedParts;
  if (parts.length <= maxMessages) {
    limitedParts = parts;
  } else {
    limitedParts = parts.slice(0, maxMessages - 1);
    limitedParts.push(parts.slice(maxMessages - 1).join(" "));
  }

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
      await sendTyping(chatId);
      const delay = calculateDelay(user, limitedParts[i]);
      await sleep(delay);

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
}

function decideModel(user, intentData) {
  if (user.stages?.stage5A_triggered) return "grok";
  if (intentData.intent === "flirt") return "grok";
  return "openai";
}

/* ================== WEBHOOK ================== */
app.post("/webhook", async (req, res) => {
  // ✅ HANDLE CALLBACK QUERY (nút inline keyboard - PPV store buttons)
  if (req.body.callback_query) {
    const handled = await handleCallbackQuery(req.body.callback_query);
    return res.sendStatus(200);
  }

  const { message } = req.body;
  if (!message || !message.text) return res.sendStatus(200);

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

  if (userBotSending.has(chatId)) { enqueueMessage(chatId, text); return res.sendStatus(200); }
  if (userBotReplying.has(chatId)) { enqueueMessage(chatId, text); return res.sendStatus(200); }

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

  user.message_count++;
  user.last_active = Date.now();
  if (user.conversation_mode === "idle" || user.conversation_mode === "resting") user.conversation_mode = "chatting";

  onUserMessage(user.state);
  resetWeeklyCounter(user.state);

  if (timeContext === "deep_night" && (user.conversation_mode === "chatting" || user.conversation_mode === "flirting") && !user.wind_down) {
    console.log(`🌙 Activating wind-down`);
    user.wind_down = true;
    user.wind_down_messages_sent = 0;
  }

  initializeStageTracking(user);
  const stageTransition = detectStageTransition(user, text);

  if (stageTransition) {
    if (stageTransition.trigger === "stage_5A" || stageTransition.trigger === "stage_5A_mild") {
      console.log(`📸 Stage 5A triggered`);
      userBotReplying.add(chatId);
      const replyText = await callGrok(
        buildGrokPrompt(user, "stage_5A"),
        buildContextPrompt(user, "stage_5A", getTimeContext()),
        text
      );
      user.has_seen_content = true;
      userBotReplying.delete(chatId);

      // ✅ NEW: smart reply-to
      const replyId = shouldReplyToMessage(user, text) ? messageId : null;
      await sendBurstReplies(user, chatId, replyText, replyId);

      // ✅ NEW: Gửi album preview sau khi bot reply stage 5A
      // Chọn album phù hợp hoặc album đầu tiên trong catalog
      await sleep(2000);
      const catalogIds = Object.keys(CATALOG);
      if (catalogIds.length > 0) {
        const albumToOffer = catalogIds[0]; // Có thể random hoặc chọn theo context
        await sendAlbumPreview(chatId, albumToOffer);
      }

      user.recentMessages.push(`Aurelia: ${replyText}`);
      if (user.recentMessages.length > 12) user.recentMessages.shift();

      // ✅ NEW: update context after bot reply
      updateConversationContext(user, replyText, "bot");

      onSaleAttempt(user.state);
      user.has_asked_support = true;
      updateStage(user, 6, "Stage 5A completed");
      return res.sendStatus(200);
    }
  }

  if (isStranger(user.state) && detectFastLane(text) && !stageTransition) {
    user.state.relationship_state = "casual";
    user.state.updatedAt = Date.now();
    console.log(`⚡ Fast lane: stranger → casual`);
  }

  // ✅ Sale success giờ được xử lý tự động qua PayPal/Crypto webhook
  // ppvStore.js sẽ gọi onSaleSuccess() sau khi payment confirmed

  /* ========= SAVE USER MESSAGE ========= */
  user.recentMessages.push(`User: ${text}`);
  if (user.recentMessages.length > 20) user.recentMessages.shift();

  if (isStranger(user.state) && detectEmotionalSupport(text)) user.emotional_ready = true;

  /* ========= CLASSIFY + EXTRACT FACTS ========= */
  const { intent: intentData, facts: extractedFacts } = await classifyMessageAndExtractFacts(user, text, user.recentMessages);

  // ✅ NEW: Refresh conversation summary every 10 messages
  await refreshConversationSummary(user);

  // Save facts
  try {
    if (extractedFacts && Object.keys(extractedFacts).length > 0) {
      const newFacts = {};
      for (const key in extractedFacts) {
        if (extractedFacts[key] && !user.memoryFacts[key]) newFacts[key] = extractedFacts[key];
      }
      if (Object.keys(newFacts).length > 0) {
        updateUser(user.chatId, { memoryFacts: { ...user.memoryFacts, ...newFacts } });
        console.log(`💾 Saved facts for ${chatId}:`, newFacts);
      }
    }
  } catch (e) {
    console.log("Memory save failed:", e.message);
  }

  // ✅ NEW: Update conversation context with user message
  updateConversationContext(user, text, "user", intentData);

  if (intentData.intent === "flirt") user.conversation_mode = "flirting";
  else if (intentData.intent === "normal") user.conversation_mode = "chatting";
  if (user.wind_down || intentData.windDown) { user.conversation_mode = "resting"; user.conversationClosed = true; }

  user.lastIntentData = intentData;
  applyIntent(user, intentData);
  const modelChoice = decideModel(user, intentData);

  /* ========= HANDLE SALE RESPONSES ========= */
  if (intentData.saleResponse === "yes") {
    user.sale_clarification_pending = false;
  } else if (intentData.saleResponse === "no") {
    onSaleFailure(user.state);
    user.sale_clarification_pending = false;
    console.log(`❌ Sale declined`);
    if (isTimeWaster(user.state)) { user.conversationClosed = true; return res.sendStatus(200); }
  } else if (intentData.saleResponse === "maybe") {
    user.sale_clarification_pending = false;
  } else if (intentData.saleResponse === "none" && user.has_asked_support) {
    user.sale_clarification_pending = true;
  }

  /* ========= SALE DECISION ========= */
  let strategy = null;
  let selectedStrategy = null;

  if (timeContext === "deep_night" && user.conversation_mode === "selling") user.wind_down = false;

  if (user.sale_clarification_pending) {
    strategy = "clarify_sale";
  } else if (isStranger(user.state) && user.stages.current >= 5 && user.emotional_ready && !user.has_asked_support) {
    const timingCheck = shouldAttemptSaleByTiming(user);
    if (timingCheck.allow || timingCheck.force) {
      strategy = "first_sale";
      user.conversation_mode = "selling";
      updateStage(user, 5, "First sale triggered");
    }
  } else if ((isCasual(user.state) || isSupporter(user.state)) && user.has_asked_support) {
    if (user.wind_down) {
      console.log(`🌙 Wind-down - blocking sale`);
    } else {
      selectedStrategy = selectRepeatStrategy(user, intentData, user.recentMessages);
      console.log(`🎯 Strategy: ${selectedStrategy.strategy} (${selectedStrategy.confidence})`);

      if (selectedStrategy.canBypass) {
        strategy = "repeat_sale";
        user.conversation_mode = "selling";
      } else {
        const timingCheck = shouldAttemptSaleByTiming(user);
        if (timingCheck.allow || timingCheck.force) {
          const contextCheck = isConversationSuitableForSale(user, intentData, user.recentMessages);
          if ((contextCheck.suitable || timingCheck.force) && (selectedStrategy.confidence >= 0.6 || timingCheck.force)) {
            strategy = "repeat_sale";
            user.conversation_mode = "selling";
          }
        }
      }
    }
  }

  if (strategy === "first_sale" || strategy === "repeat_sale") {
    onSaleAttempt(user.state);
    user.has_asked_support = true;
    user.state.lastSaleMessageCount = user.message_count;
  }

  /* ========= CALL AI ========= */
  userBotReplying.add(chatId);
  let replyText;
  try {
    if (modelChoice === "openai") {
      replyText = await callOpenAI(buildOpenAIPrompt(user, strategy), text);
    } else {
      replyText = await callGrok(
        buildGrokPrompt(user, strategy, selectedStrategy),
        buildContextPrompt(user, strategy, getTimeContext()),
        text
      );
    }
  } catch (err) {
    console.error("❌ AI call failed:", err.message);
    userBotReplying.delete(chatId);
    return res.sendStatus(200);
  }

  const assetMarkers = parseAssetMarkers(replyText);
  const cleanReplyText = assetMarkers.cleanResponse;
  userBotReplying.delete(chatId);

  // ✅ NEW: Decide whether to quote-reply
  const replyId = shouldReplyToMessage(user, text) ? messageId : null;

  (async () => {
    // ✅ UPDATED: Pass replyId vào sendBurstReplies
    await sendBurstReplies(user, chatId, cleanReplyText, replyId);
    await logBotMessage(message.from.id, cleanReplyText);

    // Send asset
    if (assetMarkers.hasAsset && !(user.wind_down && user.conversation_mode !== "selling")) {
      await sleep(1500);
      const assetData = getAssetToSend(assetMarkers, 0, chatId);
      if (assetData) {
        const { asset, shouldScheduleConfirmation, shouldSendImage } = assetData;
        if (shouldSendImage) {
          await sendUploadPhoto(chatId);
          await sleep(800);
          const sendResult = await sendAsset(chatId, asset);
          if (sendResult?.ok) console.log(`✅ Sent asset ${asset.assetId}`);
          else console.error(`❌ Failed asset: ${asset.assetId}`);
        }
        if (shouldScheduleConfirmation && user.state.totalSaleSuccess > 0) {
          const confirmation = scheduleConfirmation(chatId, asset.assetId, asset);
          if (confirmation) console.log(`📅 Scheduled confirmation ${confirmation.confirmationAssetId}`);
        }
      }
    }

    if ((strategy === "first_sale" || strategy === "repeat_sale") && botAskedForSupport(cleanReplyText)) {
      user.has_asked_support = true;
      if (user.stages.current === 5) updateStage(user, 6, "Sale asked");
    }

    /* ========= SAVE BOT REPLY ========= */
    user.recentMessages.push(`Aurelia: ${cleanReplyText}`);
    if (user.recentMessages.length > 20) user.recentMessages.shift();

    // ✅ NEW: Update context after bot reply
    updateConversationContext(user, cleanReplyText, "bot");

    if (user.wind_down && user.conversation_mode !== "selling") {
      user.wind_down_messages_sent = (user.wind_down_messages_sent || 0) + 1;
      if (user.wind_down_messages_sent >= 3) {
        user.conversation_mode = "resting";
        user.wind_down = false;
        user.wind_down_messages_sent = 0;
      }
    }

    if (!user.firstReplySent) user.firstReplySent = true;

    const summary = getStateSummary(user.state);
    console.log(`📊 User ${chatId}:`, summary);
    console.log(`🎭 Stage: ${user.stages.current} | Mood: ${user.conversationContext?.dominantMood} | Topic: ${user.conversationContext?.currentTopic}`);

    setTimeout(() => processNextInQueue(chatId), 500);
  })();

  res.sendStatus(200);
});

/* ================== PROCESS USER MESSAGE (queue) ================== */
async function processUserMessage(chatId, text, user) {
  if (userBotReplying.has(chatId) || userBotSending.has(chatId)) { enqueueMessage(chatId, text); return; }
  if (isTimeWaster(user.state) || user.conversationClosed) return;

  user.message_count++;
  user.last_active = Date.now();
  if (user.conversation_mode === "idle" || user.conversation_mode === "resting") user.conversation_mode = "chatting";

  onUserMessage(user.state);
  resetWeeklyCounter(user.state);
  initializeStageTracking(user);

  user.recentMessages.push(`User: ${text}`);
  if (user.recentMessages.length > 12) user.recentMessages.shift();

  const { intent: intentData, facts: extractedFacts } = await classifyMessageAndExtractFacts(user, text, user.recentMessages);
  await refreshConversationSummary(user);

  if (extractedFacts && Object.keys(extractedFacts).length > 0) {
    const newFacts = {};
    for (const key in extractedFacts) {
      if (extractedFacts[key] && !user.memoryFacts[key]) newFacts[key] = extractedFacts[key];
    }
    if (Object.keys(newFacts).length > 0) { Object.assign(user.memoryFacts, newFacts); console.log(`💾 Saved:`, newFacts); }
  }

  // ✅ NEW: Update context
  updateConversationContext(user, text, "user", intentData);

  if (intentData.intent === "flirt") user.conversation_mode = "flirting";
  else if (intentData.intent === "normal") user.conversation_mode = "chatting";

  applyIntent(user, intentData);
  const modelChoice = decideModel(user, intentData);

  userBotReplying.add(chatId);
  let replyText;
  try {
    if (modelChoice === "openai") {
      replyText = await callOpenAI(buildOpenAIPrompt(user, null), text);
    } else {
      replyText = await callGrok(buildGrokPrompt(user, null, null), buildContextPrompt(user, null, getTimeContext()), text);
    }
  } catch (err) {
    console.error("❌ Queue AI failed:", err.message);
    userBotReplying.delete(chatId);
    return;
  }

  const assetMarkers = parseAssetMarkers(replyText);
  const cleanReplyText = assetMarkers.cleanResponse;
  userBotReplying.delete(chatId);

  // Queue messages don't have original messageId, so no quote reply
  await sendBurstReplies(user, chatId, cleanReplyText, null);
  await logBotMessage(chatId, cleanReplyText);

  user.recentMessages.push(`Aurelia: ${cleanReplyText}`);
  if (user.recentMessages.length > 12) user.recentMessages.shift();

  // ✅ NEW: Update context
  updateConversationContext(user, cleanReplyText, "bot");

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
          await sendBurstReplies(users[chatId], chatId, "Look what I got! 💕 Thank you so much~");
        }
      } catch (error) {
        console.error(`❌ Confirmation error for ${chatId}:`, error);
      }
    }
  }
}
setInterval(checkAndSendPendingConfirmations, 5 * 60 * 1000);

/* ================== SERVER ================== */
app.listen(port, () => console.log(`🌸 Aurelia running on port ${port}`));

export { buildContextPrompt, buildOpenAIPrompt, buildGrokPrompt };
