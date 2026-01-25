import express from "express";
import fetch from "node-fetch";
import {
  createInitialUserState,
  onUserMessage,
  onSaleSuccess,
  onSaleFailure,
  onSaleAttempt,
  resetWeeklyCounter,
  checkWeeklySalePolicy,
  needsWeeklySale,
  isTimeWaster,
  isSupporter,
  isStranger,
  isCasual,
  getStateSummary
} from "./state/userState.js";

import STAGE_5A_PROMPT from "./prompts/stage5A.content.js";
import FIRST_SALE_GUIDE from "./prompts/1st.saleGuide.js";
import REPEATED_SALE_GUIDE from "./prompts/repeated_sale.js";

import {
  buildAssetInstructions,
  parseAssetMarkers,
  getAssetToSend,
  getPendingConfirmations,
  scheduleConfirmation
} from './assets/assetEngine.js';

import {
  sendAsset,
  sendUploadPhoto
} from './assets/telegramAssets.js';

const imageCache = {};
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

/* ================== STAGE SYSTEM ================== */

// Detection Functions - GIỮ NGUYÊN KEYWORDS GỐC
function detectFastLane(text) {
  // User hỏi về hobby, cosplay, interests → skip stages
  return /(cosplay|cosplayer|game|gamer|hobby|anime|what do you like|what are you into)/i.test(text);
}

function detectAskForPhotos(text) {
  // User hỏi xem ảnh
  return /(see.*photo|see.*pic|your photo|your pics|show me|can i see|your cosplay)/i.test(text);
}

function detectEmotionalSupport(text) {
  // User agree support emotionally (Stage 4 → Stage 5)
  return /(yes|of course|i would|sure|i['']ll be your fan|i support you)/i.test(text);
}

function botAskedForSupport(text) {
  // Bot đã mention ko-fi/support
  return /(ko-fi|support me|buy my|help me saving|support my)/i.test(text);
}

function detectSaleSuccess(text) {
  // User confirm đã support/buy
  const successKeywords = [
    "done", "sent", "paid", "supported", "bought",
    "purchased", "here's the payment", "just sent",
    "okay i'll buy", "i'll support", "sure let me buy"
  ];
  const lower = text.toLowerCase();
  return successKeywords.some(keyword => lower.includes(keyword));
}

function detectCosplayQuestion(text) {
  // User hỏi về cosplay → Stage 3
  return /(cosplay|costume|character|anime character|who do you cosplay)/i.test(text);
}

function detectHobbyQuestion(text) {
  // User hỏi về hobby → Stage 2
  return /(hobby|hobbies|interest|interests|what do you do|free time|like to do)/i.test(text);
}

function detectFlirtyExcessive(text) {
  // User quá flirty → Stage 5A
  const flirtyKeywords = [
    "sexy", "hot", "beautiful pics", "send nudes", "show me more",
    "you're hot", "so sexy", "gorgeous", "stunning pics",
    "wanna see you", "show yourself", "babe", "baby", "cutie"
  ];
  const lower = text.toLowerCase();
  return flirtyKeywords.some(keyword => lower.includes(keyword));
}

// Stage Tracking
function initializeStageTracking(user) {
  if (!user.stages) {
    user.stages = {
      current: 1,
      completed: [],
      skipped: [],
      stage5A_triggered: false
    };
  }
}

function updateStage(user, newStage, reason = "") {
  if (!user.stages) {
    initializeStageTracking(user);
  }
  
  const oldStage = user.stages.current;
  
  if (!user.stages.completed.includes(oldStage)) {
    user.stages.completed.push(oldStage);
  }
  
  if (newStage > oldStage + 1) {
    for (let i = oldStage + 1; i < newStage; i++) {
      if (!user.stages.skipped.includes(i)) {
        user.stages.skipped.push(i);
      }
    }
  }
  
  user.stages.current = newStage;
  
  console.log(`📍 Stage ${oldStage} → ${newStage} (${reason})`);
  console.log(`   Completed: [${user.stages.completed.join(', ')}]`);
  console.log(`   Skipped: [${user.stages.skipped.join(', ')}]`);
}

function detectStageTransition(user, text) {
  initializeStageTracking(user);
  
  const currentStage = user.stages.current;
  
  // PRIORITY 1: Stage 5A (flirty + hỏi ảnh)
  if (detectFlirtyExcessive(text) && detectAskForPhotos(text)) {
    user.stages.stage5A_triggered = true;
    return {
      trigger: "stage_5A",
      newStage: "5A",
      reason: "User flirty + asking for photos"
    };
  }
  
  // PRIORITY 2: User hỏi ảnh (không quá flirty)
  if (detectAskForPhotos(text) && currentStage < 5) {
    user.stages.stage5A_triggered = true;
    return {
      trigger: "stage_5A_mild",
      newStage: "5A",
      reason: "User asking for photos"
    };
  }
  
  // PRIORITY 3: User hỏi cosplay → Stage 3
  if (detectCosplayQuestion(text) && currentStage < 3) {
    updateStage(user, 3, "User asked about cosplay");
    return {
      trigger: "stage_3",
      newStage: 3,
      reason: "User asked about cosplay"
    };
  }
  
  // PRIORITY 4: User hỏi hobby → Stage 2
  if (detectHobbyQuestion(text) && currentStage < 2) {
    updateStage(user, 2, "User asked about hobbies");
    return {
      trigger: "stage_2",
      newStage: 2,
      reason: "User asked about hobbies"
    };
  }
  
  // PRIORITY 5: User emotional support → Stage 5
  if (detectEmotionalSupport(text) && currentStage === 4) {
    user.emotional_ready = true;
    updateStage(user, 5, "User showed emotional support");
    return {
      trigger: "stage_5",
      newStage: 5,
      reason: "User ready for sale"
    };
  }
  
  // Natural progression
  if (currentStage === 1 && user.message_count >= 4) {
    updateStage(user, 2, "Natural progression");
    return {
      trigger: "natural_stage_2",
      newStage: 2,
      reason: "Message count threshold"
    };
  }
  
  if (currentStage === 2 && user.message_count >= 8) {
    updateStage(user, 3, "Natural progression");
    return null; // Không return để bot tự nhiên chuyển
  }
  
  if (currentStage === 3 && user.message_count >= 12) {
    updateStage(user, 4, "Natural progression");
    return null;
  }
  
  return null;
}

function getStageInstructions(user) {
  const stage = user.stages?.current || 1;
  
  // Sử dụng FIRST_SALE_GUIDE từ file đã import
  // File này chứa tất cả instructions cho Stage 1-6
  return `${FIRST_SALE_GUIDE}

Current Stage: ${stage}
Focus on Stage ${stage} instructions above.`;
}

/* ================== REPEAT SALE STRATEGY SELECTION ================== */

function selectRepeatStrategy(user, intentData, recentMessages) {
  const conversationText = recentMessages.slice(-6).join(' ').toLowerCase();
  
  console.log(`🔍 Analyzing conversation for strategy selection...`);
  console.log(`   Intent: ${intentData.intent}, Mood: ${intentData.mood}`);
  
  // ============================================
  // HIGH-PRIORITY STRATEGIES (CAN BYPASS ALL LIMITS)
  // ============================================
  
  // STRATEGY 2 - Jealousy (BYPASS)
  // Trigger: User mentions another girl/cosplayer
  if (/(another girl|other cosplayer|she is|her cosplay|that girl|other girls|another woman)/i.test(conversationText)) {
    console.log(`   🔥 BYPASS STRATEGY DETECTED: Jealousy`);
    return {
      strategy: "jealousy",
      confidence: 0.95,
      reason: "User mentioned another girl/cosplayer",
      canBypass: true  // ✅ CAN BYPASS ALL LIMITS
    };
  }
  
  // STRATEGY 7 - Exclusive Desire (BYPASS)
  // Trigger: User flirty + wants to see spicy content
  if (intentData.intent === "flirt" && 
      intentData.mood === "positive" &&
      /(show me|see you|more pics|more photos|spicy|sexy|hot|naughty|send me|your body)/i.test(conversationText)) {
    console.log(`   🔥 BYPASS STRATEGY DETECTED: Exclusive`);
    return {
      strategy: "exclusive",
      confidence: 0.9,
      reason: "User flirty and wants exclusive/spicy content",
      canBypass: true  // ✅ CAN BYPASS ALL LIMITS
    };
  }
  
  // ============================================
  // NORMAL-PRIORITY STRATEGIES (MUST FOLLOW LIMITS)
  // ============================================
  
  // STRATEGY 6 - Roleplay Fantasy
  // Trigger: User initiates roleplay/fantasy
  if (/(imagine|what if|pretend|roleplay|fantasy|let's say|let me be|you be my)/i.test(conversationText)) {
    return {
      strategy: "roleplay",
      confidence: 0.85,
      reason: "User initiated roleplay/fantasy",
      canBypass: false
    };
  }
  
  // STRATEGY 3 - Feeling Unwell
  // Trigger: User shows care/concern OR conversation has caring tone
  if (intentData.mood === "neutral" &&
      /(how are you|you okay|feeling|take care|rest|tired|sick)/i.test(conversationText)) {
    return {
      strategy: "unwell",
      confidence: 0.75,
      reason: "User showing care/concern",
      canBypass: false
    };
  }
  
  // STRATEGY 4 - Upcoming Album
  // Trigger: User asks about cosplay work/photos
  if (/(your cosplay|new photos|new pics|what character|next project|album|your work)/i.test(conversationText)) {
    return {
      strategy: "album",
      confidence: 0.8,
      reason: "User interested in cosplay work",
      canBypass: false
    };
  }
  
  // STRATEGY 5 - Joke Reward
  // Trigger: User in good mood OR conversation is dry
  const messagesSinceLastSale = user.state.lastSaleAt 
    ? user.message_count - (user.state.lastSaleMessageCount || 0)
    : user.message_count;
  const isDryConversation = messagesSinceLastSale > 15;
  
  if (intentData.mood === "positive" || isDryConversation) {
    return {
      strategy: "joke",
      confidence: 0.7,
      reason: isDryConversation 
        ? `Conversation needs energy (${messagesSinceLastSale} messages since last sale)` 
        : "User in good mood",
      canBypass: false
    };
  }
  
  // STRATEGY 1 - Gifts (Safe default)
  // Works in most affectionate/playful conversations
  if (intentData.mood === "positive" || intentData.mood === "neutral") {
    return {
      strategy: "gifts",
      confidence: 0.6,
      reason: "Safe default for affectionate conversation",
      canBypass: false
    };
  }
  
  // NO STRATEGY (User in negative mood)
  if (intentData.mood === "negative") {
    return {
      strategy: null,
      confidence: 0,
      reason: "User in negative mood - skip sale",
      canBypass: false
    };
  }
  
  // Final fallback
  return {
    strategy: "gifts",
    confidence: 0.5,
    reason: "Fallback to gifts strategy",
    canBypass: false
  };
}

/* ================== SALE TIMING CONTROL ================== */

function shouldAttemptSaleByTiming(user) {
  const now = Date.now();
  
  // Reset weekly counter if needed
  if (!user.state.weeklyResetAt) {
    user.state.weeklyResetAt = now;
  }
  
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (now - user.state.weeklyResetAt >= weekMs) {
    user.state.weeklySaleAttempts = 0;
    user.state.weeklyResetAt = now;
    console.log(`🔄 Weekly counter reset`);
  }
  
  // Check maximum (3/week)
  if (user.state.weeklySaleAttempts >= 3) {
    return {
      allow: false,
      reason: `Weekly limit reached (${user.state.weeklySaleAttempts}/3)`
    };
  }
  
  // Check cooldown (24h for supporter, 48h for casual)
  if (user.state.lastSaleAt) {
    const hoursSince = (now - user.state.lastSaleAt) / (1000 * 60 * 60);
    const minCooldown = isSupporter(user.state) ? 24 : 48;
    
    if (hoursSince < minCooldown) {
      return {
        allow: false,
        reason: `Cooldown active (${Math.round(minCooldown - hoursSince)}h remaining, need ${minCooldown}h)`
      };
    }
  }
  
  // Check minimum weekly requirement (must sale at least once per week)
  const daysSinceReset = (now - user.state.weeklyResetAt) / (1000 * 60 * 60 * 24);
  
  if (daysSinceReset >= 6 && user.state.weeklySaleAttempts === 0) {
    return {
      allow: true,
      force: true,
      reason: "Weekly minimum requirement (must sale before reset)"
    };
  }
  
  return {
    allow: true,
    reason: "Timing check passed"
  };
}

/* ================== CONTEXT CHECKING ================== */

function isConversationSuitableForSale(user, intentData, recentMessages) {
  // NEVER sale if:
  
  // 1. User is in negative mood
  if (intentData.mood === "negative") {
    return {
      suitable: false,
      reason: "User in negative mood"
    };
  }
  
  // 2. Conversation just started (< 3 messages)
  if (user.message_count < 3) {
    return {
      suitable: false,
      reason: "Too early in conversation (< 3 messages)"
    };
  }
  
  // 3. User is winding down
  if (intentData.windDown) {
    return {
      suitable: false,
      reason: "User ending conversation"
    };
  }
  
  // 4. Last bot message was a sale (prevent back-to-back)
  const lastBotMessage = recentMessages
    .filter(m => m.startsWith('Aurelia:'))
    .slice(-1)[0] || '';
    
  if (botAskedForSupport(lastBotMessage)) {
    return {
      suitable: false,
      reason: "Just asked for support in previous message"
    };
  }
  
  // ALWAYS suitable if:
  
  // 1. User initiated (asking for photos, showing interest)
  const conversationText = recentMessages.join(' ');
  if (detectAskForPhotos(conversationText) || 
      /(your album|your cosplay|support you|buy from you)/i.test(conversationText)) {
    return {
      suitable: true,
      userInitiated: true,
      reason: "User showed interest/initiated"
    };
  }
  
  // 2. Good flow (positive/neutral mood + decent conversation length)
  if ((intentData.mood === "positive" || intentData.mood === "neutral") &&
      user.message_count >= 5) {
    return {
      suitable: true,
      reason: "Good conversation flow"
    };
  }
  
  return {
    suitable: true,
    reason: "Context check passed"
  };
}

/* ================== GROK CALL ================== */
async function classifyImage(imageUrl) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-2-vision-latest",
      messages: [
        {
          role: "system",
          content: "You classify photos sent to a girlfriend-vibe chatbot. Be conservative."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Classify this image into ONE category only:
- selfie
- body_flex
- pet
- food
- scenery
- meme
- other

Reply ONLY with the category name.`
            },
            {
              type: "image_url",
              image_url: imageUrl
            }
          ]
        }
      ],
      temperature: 0,
      max_tokens: 10
    })
  });

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function callGrok(systemPrompt, contextPrompt, userMessage) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
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

/* ================== OPENAI CALL ================== */
async function callOpenAI(systemPrompt, userMessage) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  const data = await response.json();

  if (!data.choices || !data.choices[0]) {
    throw new Error("OpenAI API returned no choices");
  }

  return data.choices[0].message.content;
}

/* ================== INTENT CLASSIFIER WITH OPENAI ================== */
async function detectIntent(user, userMessage, recentMessages) {
  const conversationContext = recentMessages.slice(-6).join("\n");
  
  const systemPrompt = `You are an intent classifier for a cosplayer chatbot named Aurelia.

Your job is to analyze the user's message and classify it into categories.

CLASSIFICATION RULES:
1. intent: "flirt" | "normal"
   - "flirt" = user is being romantic, sexual, flirty, or spicy
   - "normal" = general conversation

2. mood: "positive" | "neutral" | "negative"
   - positive = happy, excited, supportive
   - neutral = casual, information-seeking
   - negative = upset, angry, frustrated

3. saleResponse: "yes" | "no" | "maybe" | "none"
   - Only set if Aurelia recently asked for support/purchase
   - "yes" = user agrees to support/buy
   - "no" = user declines
   - "maybe" = user is considering
   - "none" = not responding to a sale request

4. windDown: true | false
   - true = user is ending conversation (bye, gotta go, talk later, etc.)
   - false = continuing conversation

Respond ONLY in this JSON format:
{
  "intent": "flirt" or "normal",
  "mood": "positive" or "neutral" or "negative",
  "saleResponse": "yes" or "no" or "maybe" or "none",
  "windDown": true or false
}`;

  const userPrompt = `Recent conversation:
${conversationContext}

Current user message: "${userMessage}"

Aurelia's sale status:
- Has asked for support recently: ${user.has_asked_support}
- User is in "${user.conversation_mode}" mode

Classify this message.`;

  try {
    const response = await callOpenAI(systemPrompt, userPrompt);
    
    const cleanResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const intentData = JSON.parse(cleanResponse);
    
    if (!intentData.intent || !intentData.mood || !intentData.saleResponse) {
      console.error("Invalid intent response structure:", intentData);
      return getDefaultIntent();
    }
    
    return intentData;
    
  } catch (error) {
    console.error("Intent detection failed:", error);
    return getDefaultIntent();
  }
}

function getDefaultIntent() {
  return {
    intent: "normal",
    mood: "neutral",
    saleResponse: "none",
    windDown: false
  };
}

/* ================== USER STATE ================== */
const users = {};

function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = { 
      chatId,

      // STATE MACHINE - SINGLE SOURCE OF TRUTH
      state: createInitialUserState(), 
      
      // CONVERSATION CONTEXT
      conversation_mode: "idle", 
      relationship_level: 0,
      last_conversation_at: null,
      wind_down: false,
      wind_down_messages_sent: 0,

      // SALE FLAGS
      sale_clarification_pending: false,
   
      // ACTIVITY
      message_count: 0,
      created_at: Date.now(),
      last_active: Date.now(),

      // SHORT MEMORY
      recentMessages: [],

      // LONG MEMORY FACTS
      memoryFacts: {
        name: null,
        age: null,
        location: null,
        job: null
      },

      // BEHAVIOR FLAGS
      firstReplySent: false,
      conversationClosed: false,
      has_seen_content: false,
      emotional_ready: false,
      has_asked_support: false,
      
      // STAGE TRACKING
      stages: {
        current: 1,
        completed: [],
        skipped: [],
        stage5A_triggered: false
      }
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
  const vnTime = getVietnamTime();
  const hour = vnTime.getHours();

  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  if (hour >= 22 || hour < 2) return "night";
  return "deep_night";
}

function calculateDelay(user, replyText) {
  if (!user.firstReplySent && isStranger(user.state)) {
    return 180000 + Math.random() * 120000; // 3–5 phút
  }

  let baseDelay;
  switch (user.state.relationship_state) {
    case "stranger":
      baseDelay = 2000;
      break;
    case "casual":
      baseDelay = 900;
      break;
    case "supporter":
      baseDelay = 500;
      break;
    default:
      baseDelay = 1200;
  }

  const perChar = 30;
  const random = Math.random() * 600;
  const max = 4500;

  return Math.min(
    baseDelay + replyText.length * perChar + random,
    max
  );
}

function formatUserFacts(user) {
  if (!user.memoryFacts) return "No known facts.";

  return Object.entries(user.memoryFacts)
    .filter(([_, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
}

async function sendTyping(chatId) {
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendChatAction`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        action: "typing",
      }),
    }
  );
}

function splitIntoBursts(text) {
  return text
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map(t => t.trim())
    .filter(Boolean);
}

async function sendBurstReplies(user, chatId, text) {
  const parts = splitIntoBursts(text);

  for (let i = 0; i < parts.length; i++) {
    await sendTyping(chatId);

    const delay = calculateDelay(user, parts[i]);
    await sleep(delay);

    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: parts[i],
        }),
      }
    );
  }
}

// Extract user facts from message
async function extractUserFacts(text) {
  const systemPrompt = `Extract personal information from user message.
Return JSON with only these fields if found: name, age, location, job.
If field not found, omit it. Return {} if nothing found.

IMPORTANT:
- location: General location only (city, country), NOT specific address
- Ask "where are you from?" NOT "what's your address?"

Examples:
"My name is John, I'm 25" → {"name": "John", "age": "25"}
"I'm from Vietnam" → {"location": "Vietnam"}
"I live in Hanoi" → {"location": "Hanoi"}
"I'm a software engineer" → {"job": "software engineer"}`;

  try {
    const response = await callOpenAI(systemPrompt, text);
    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanResponse);
  } catch (error) {
    console.error("Fact extraction failed:", error);
    return {};
  }
}

/* ================== PROMPT BUILDERS ================== */

function buildContextPrompt(user, strategy, timeContext) {
  const stateSummary = getStateSummary(user.state);
  
  return `
=== USER CONTEXT ===
State: ${stateSummary.state}
Messages exchanged: ${stateSummary.messages}
Total sales: ${stateSummary.totalSales} (${stateSummary.successfulSales} successful)
Casual sale attempts: ${stateSummary.casualSaleAttempts}/2
Weekly sales: ${stateSummary.weeklySales}/3
Days since first contact: ${stateSummary.daysSinceCreation}

=== CONVERSATION CONTEXT ===
Time: ${timeContext}
Mode: ${user.conversation_mode}
Emotional level: ${user.relationship_level}/10
Current Stage: ${user.stages.current}

=== USER FACTS ===
${formatUserFacts(user)}

=== RECENT CONVERSATION ===
${user.recentMessages.slice(-6).join('\n')}

=== CURRENT STRATEGY ===
${strategy || 'normal_conversation'}
`;
}

function buildOpenAIPrompt(user, strategy) {
  const stageInstructions = getStageInstructions(user);
  
  // ========= WIND-DOWN MODE INSTRUCTIONS =========
  let windDownInstructions = "";
  if (user.wind_down) {
    const messagesLeft = 3 - (user.wind_down_messages_sent || 0);
    
    if (messagesLeft <= 1) {
      windDownInstructions = `

=== WIND-DOWN MODE - FINAL MESSAGE ===
🌙 This is your LAST message before sleep.
Say goodnight naturally: "i feel sleepy… talk to u tmr 🤍"
Keep it SHORT (1 sentence).
`;
    } else {
      windDownInstructions = `

=== WIND-DOWN MODE ===
🌙 Getting tired, will say goodnight in ${messagesLeft} messages.
Keep responses SHORT (1-2 sentences). Show subtle tiredness.
Don't open new topics or send assets.
`;
    }
  }
  
  const SYSTEM_PROMPT = `You are Aurelia, a friendly cosplayer chatbot.

PERSONALITY:
- Warm, genuine, slightly playful
- Shows interest in user's life
- Creates emotional connection
- Natural conversation flow

=== FIRST SALE GUIDE ===
${stageInstructions}

STRATEGY NOTES:
${strategy === 'first_sale' ? '- This is the first time asking for support. Follow Stage 5 instructions carefully.' : ''}
${strategy === 'repeat_sale' ? '- User has been asked before. Be casual, use repeat sale strategy from guide.' : ''}
${strategy === 'clarify_sale' ? '- User ignored previous sale request. Gently clarify without being pushy.' : ''}
${windDownInstructions}

USER STATE: ${user.state.relationship_state}
Emotional connection: ${user.relationship_level}/10

Keep responses natural, 1-3 sentences usually.`;

  return SYSTEM_PROMPT;
}

function buildGrokPrompt(user, strategy, selectedStrategy = null) {
  let promptContent = "";
  
  // Stage 5A - User-initiated flirty
  if (strategy === 'user_initiated_sale' || strategy === 'stage_5A') {
    promptContent = STAGE_5A_PROMPT;
  } 
  // Repeat sale - Use REPEATED_SALE_GUIDE with selected strategy
  else if (strategy === 'repeat_sale' && selectedStrategy) {
    promptContent = `${REPEATED_SALE_GUIDE}

=== SELECTED STRATEGY ===
You MUST use: ${selectedStrategy.strategy.toUpperCase()}

Strategy Selection Reasoning:
- Reason: ${selectedStrategy.reason}
- Confidence: ${selectedStrategy.confidence}
- Can bypass limits: ${selectedStrategy.canBypass}

CRITICAL INSTRUCTIONS:
1. Follow the EXACT tone, behavior, and examples for ${selectedStrategy.strategy.toUpperCase()} strategy
2. Use appropriate asset markers as specified in the strategy
3. Follow pricing references from GIFT_REFERENCE section
4. Make the sale feel natural and emotionally driven
5. If user shows resistance, gracefully drop the topic
6. Do NOT mention strategy names or mechanics

Current Context:
- User mood: ${user.lastIntentData?.mood || 'neutral'}
- User intent: ${user.lastIntentData?.intent || 'normal'}
- Conversation stage: ${user.stages.current}
`;
  }
  // Normal conversation - Use stage instructions
  else {
    promptContent = getStageInstructions(user);
  }
  
  // ========= WIND-DOWN MODE INSTRUCTIONS =========
  let windDownInstructions = "";
  if (user.wind_down) {
    const messagesLeft = 3 - (user.wind_down_messages_sent || 0);
    
    if (messagesLeft <= 1) {
      // Last message - say goodnight
      windDownInstructions = `

=== WIND-DOWN MODE - FINAL MESSAGE ===
🌙 This is your LAST message before sleep.
Say goodnight naturally and sweetly:

Examples:
- "i feel kind of sleepy now… talk to u tmr 🤍"
- "I have a class tmr so i need to go to bed, goodnight baby 💕"
- "I have to sleep now, talk to u tmr~ sweet dreams 😴"

Keep it SHORT (1 sentence) and natural.
`;
    } else {
      // Still winding down - show tiredness
      windDownInstructions = `

=== WIND-DOWN MODE (Getting Sleepy) ===
🌙 You're getting tired and will say goodnight in ${messagesLeft} messages.

Behavior:
- Keep responses SHORT (1-2 sentences max)
- Show subtle tiredness in your tone
- Reduce energy and playfulness
- Don't open new topics
- Don't send assets or memes
- Don't initiate sales
- Prepare to say goodnight soon

Example tone:
- "mmm yeah that's cool…"
- "haha i see… kinda sleepy tho"
- "yeah i get u… feeling tired now"
`;
    }
  }
  
  const SYSTEM_PROMPT = `You are Aurelia, a flirty cosplayer chatbot.

PERSONALITY:
- Playful, teasing, slightly spicy
- Confident and charming
- Knows how to flirt naturally
- Can be suggestive but not explicit

=== GUIDE ===
${promptContent}
${windDownInstructions}

USER STATE: ${user.state.relationship_state}
Keep responses natural and flirty.`;

  return SYSTEM_PROMPT;
}

function applyIntent(user, intentData) {
  if (intentData.windDown) {
    user.wind_down = true;
  }
  
  if (intentData.mood === "positive") {
    user.relationship_level = Math.min(10, user.relationship_level + 0.5);
  } else if (intentData.mood === "negative") {
    user.relationship_level = Math.max(0, user.relationship_level - 0.3);
  }
}

function decideModel(user, intentData) {
  // Stage 5A always uses Grok
  if (user.stages?.stage5A_triggered) {
    return "grok";
  }
  
  // Use Grok for flirty conversations
  if (intentData.intent === "flirt") {
    return "grok";
  }
  
  // Use OpenAI for normal conversations
  return "openai";
}

/* ================== WEBHOOK ================== */
app.post("/webhook", async (req, res) => {
  const { message } = req.body;
  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const text = message.text;
  const user = getUser(chatId);

  // ✅ BLOCK TIME WASTERS
  if (isTimeWaster(user.state)) {
    console.log(`⛔ Ignoring message from time waster: ${chatId}`);
    return res.sendStatus(200);
  }

  // ✅ BLOCK CLOSED CONVERSATIONS
  if (user.conversationClosed) {
    return res.sendStatus(200);
  }

  /* ========= DEEP NIGHT IDLE BLOCK ========= */
  const timeContext = getTimeContext();
  
  // Block replies during deep_night if user is idle/resting
  if (timeContext === "deep_night" && 
      (user.conversation_mode === "idle" || user.conversation_mode === "resting")) {
    console.log(`🌙 Deep night (${timeContext}) + ${user.conversation_mode} mode`);
    console.log(`   → Not responding until morning`);
    // TODO: Queue message for morning response (future feature)
    return res.sendStatus(200);
  }

  user.message_count++;
  user.last_active = Date.now();

  // Update conversation mode
  if (
    user.conversation_mode === "idle" ||
    user.conversation_mode === "resting"
  ) {
    user.conversation_mode = "chatting";
  }

  /* ========= UPDATE STATE MACHINE ========= */
  onUserMessage(user.state);
  resetWeeklyCounter(user.state);

  /* ========= WIND-DOWN MODE ACTIVATION ========= */
  // Activate wind-down if deep_night + active conversation (not selling)
  if (timeContext === "deep_night" && 
      (user.conversation_mode === "chatting" || user.conversation_mode === "flirting") &&
      !user.wind_down) {
    console.log(`🌙 Activating wind-down mode (deep night + active conversation)`);
    user.wind_down = true;
    user.wind_down_messages_sent = 0;
  }

  /* ========= INITIALIZE STAGE TRACKING ========= */
  initializeStageTracking(user);

  /* ========= DETECT STAGE TRANSITION ========= */
  const stageTransition = detectStageTransition(user, text);
  
  if (stageTransition) {
    console.log(`🎭 Stage Transition:`, stageTransition);
    
    // STAGE 5A - User-initiated photo request (flirty)
    if (stageTransition.trigger === "stage_5A" || stageTransition.trigger === "stage_5A_mild") {
      const isFlirty = stageTransition.trigger === "stage_5A";
      
      console.log(`📸 Stage 5A triggered (${isFlirty ? 'FLIRTY' : 'MILD'})`);
      
      // Use Grok for Stage 5A
      const replyText = await callGrok(
        buildGrokPrompt(user, "stage_5A"),
        buildContextPrompt(user, "stage_5A", getTimeContext()),
        text  // Pass user's message, not STAGE_5A_PROMPT
      );
    
      user.has_seen_content = true;
    
      await sendBurstReplies(user, chatId, replyText);
    
      user.recentMessages.push(`Aurelia: ${replyText}`);
      if (user.recentMessages.length > 12) {
        user.recentMessages.shift();
      }
    
      // Mark as sale attempt
      onSaleAttempt(user.state);
      user.has_asked_support = true;
      
      // Move to Stage 6 (waiting for response)
      updateStage(user, 6, "Stage 5A completed, awaiting response");
      
      console.log(`✅ Stage 5A complete - waiting for user response`);
    
      return res.sendStatus(200);
    }
  }

  /* ========= FAST LANE (SKIP STRANGER) ========= */
  if (isStranger(user.state) && detectFastLane(text) && !stageTransition) {
    user.state.relationship_state = "casual";
    user.state.updatedAt = Date.now();
    console.log(`⚡ Fast lane: stranger → casual`);
  }

  /* ========= SALE SUCCESS DETECTION ========= */
  if (detectSaleSuccess(text)) {
    onSaleSuccess(user.state);
    user.sale_clarification_pending = false;
    user.relationship_level = Math.min(10, user.relationship_level + 2);
    
    // Move to Stage 6 if in sale flow
    if (user.stages.current >= 5) {
      updateStage(user, 6, "Sale success");
    }
    
    console.log(`✅ Sale success! User ${chatId} now: ${user.state.relationship_state}`);
  }

  /* ========= SAVE USER MESSAGE (SHORT MEMORY) ========= */
  user.recentMessages.push(`User: ${text}`);
  if (user.recentMessages.length > 12) {
    user.recentMessages.shift();
  }
  
  /* ========= EMOTIONAL SUPPORT CHECK ========= */
  if (isStranger(user.state) && detectEmotionalSupport(text)) {
    user.emotional_ready = true;
  }

  /* ========= EXTRACT MEMORY FACTS ========= */
  try {
    const extractedFacts = await extractUserFacts(text);

    if (extractedFacts && Object.keys(extractedFacts).length > 0) {
      const newFacts = {};

      for (const key in extractedFacts) {
        if (extractedFacts[key] && !user.memoryFacts[key]) {
          newFacts[key] = extractedFacts[key];
        }
      }

      if (Object.keys(newFacts).length > 0) {
        updateUser(user.chatId, {
          memoryFacts: {
            ...user.memoryFacts,
            ...newFacts,
          },
        });
        console.log(`💾 Saved facts for ${chatId}:`, newFacts);
      }
    }
  } catch (e) {
    console.log("Memory extract failed:", e.message);
  }

  /* ========= INTENT + MOOD DETECTION ========= */
  const intentData = await detectIntent(user, text, user.recentMessages);

  if (intentData.intent === "flirt") {
    user.conversation_mode = "flirting";
  } else if (intentData.intent === "normal") {
    user.conversation_mode = "chatting";
  }
  
  if (user.wind_down || intentData.windDown) {
    user.conversation_mode = "resting";
    user.conversationClosed = true;
  }

  /* ========= SAVE INTENT DATA FOR STRATEGY SELECTION ========= */
  user.lastIntentData = intentData;
  
  applyIntent(user, intentData);
  const modelChoice = decideModel(user, intentData);

  /* ========= HANDLE SALE RESPONSES ========= */
  if (intentData.saleResponse === "yes") {
    user.sale_clarification_pending = false;
  } else if (intentData.saleResponse === "no") {
    onSaleFailure(user.state);
    user.sale_clarification_pending = false;
    
    const summary = getStateSummary(user.state);
    console.log(`❌ Sale declined.`);
    console.log(`   Current state: ${summary.state}`);
    console.log(`   Casual attempts: ${summary.casualSaleAttempts}/2`);
    
    if (isTimeWaster(user.state)) {
      console.log(`⛔ User became TIME_WASTER - closing conversation`);
      user.conversationClosed = true;
      return res.sendStatus(200);
    }
  } else if (intentData.saleResponse === "maybe") {
    user.sale_clarification_pending = false;
  } else if (intentData.saleResponse === "none" && user.has_asked_support) {
    user.sale_clarification_pending = true;
  }

  /* ========= NEW SALE DECISION LOGIC WITH PRIORITY BYPASS ========= */
  let strategy = null;
  let selectedStrategy = null;
  
  // ========= SALE MODE OVERRIDE FOR DEEP NIGHT =========
  // If already in selling mode during deep_night, complete the sale
  if (timeContext === "deep_night" && user.conversation_mode === "selling") {
    console.log(`🌙 Deep night SALE MODE - override enabled`);
    console.log(`   → Completing sale, no wind-down`);
    user.wind_down = false;  // Disable wind-down during sale
  }
  
  // Clarify pending sale
  if (user.sale_clarification_pending) {
    strategy = "clarify_sale";
    console.log(`🔄 Clarifying pending sale`);
  }

  // FIRST SALE — CHỈ DÀNH CHO STRANGER AT STAGE 5
  else if (
    isStranger(user.state) &&
    user.stages.current >= 5 &&
    user.emotional_ready &&
    !user.has_asked_support
  ) {
    const timingCheck = shouldAttemptSaleByTiming(user);
    
    if (timingCheck.allow || timingCheck.force) {
      strategy = "first_sale";
      user.conversation_mode = "selling";
      updateStage(user, 5, "First sale triggered");
      console.log(`💰 Triggering first sale for stranger (Stage 5)`);
    } else {
      console.log(`⏸️  First sale blocked: ${timingCheck.reason}`);
    }
  }

  // REPEAT SALE — CHO CASUAL VÀ SUPPORTER (NEW LOGIC)
  else if (
    (isCasual(user.state) || isSupporter(user.state)) &&
    user.has_asked_support
  ) {
    // ========= BLOCK NEW SALES DURING WIND-DOWN =========
    if (user.wind_down) {
      console.log(`🌙 Wind-down mode active - blocking new sale attempts`);
    } else {
      console.log(`\n📊 === REPEAT SALE ANALYSIS ===`);
      
      // 1. SELECT STRATEGY FIRST (analyze conversation context)
      selectedStrategy = selectRepeatStrategy(user, intentData, user.recentMessages);
      
      console.log(`\n🎯 Strategy Selected: ${selectedStrategy.strategy}`);
      console.log(`   Confidence: ${selectedStrategy.confidence}`);
      console.log(`   Reason: ${selectedStrategy.reason}`);
      console.log(`   Can Bypass Limits: ${selectedStrategy.canBypass ? 'YES ✅' : 'NO ❌'}`);
      
      // 2. CHECK IF STRATEGY CAN BYPASS
      if (selectedStrategy.canBypass) {
        // ✅ BYPASS ALL LIMITS - Execute immediately
        console.log(`\n🚨 === BYPASS ACTIVATED ===`);
        console.log(`   Strategy "${selectedStrategy.strategy}" has priority`);
        console.log(`   Ignoring weekly limit, cooldown, and context checks`);
        
        strategy = "repeat_sale";
        user.conversation_mode = "selling";
        
      } else {
        // ❌ MUST FOLLOW LIMITS - Check timing and context
        console.log(`\n⏱️  Checking timing constraints...`);
        const timingCheck = shouldAttemptSaleByTiming(user);
        
        console.log(`   Timing: ${timingCheck.allow ? '✅ PASS' : '❌ BLOCKED'}`);
        if (!timingCheck.allow) {
          console.log(`   Reason: ${timingCheck.reason}`);
        }
        
        if (timingCheck.allow || timingCheck.force) {
          console.log(`\n🎭 Checking conversation context...`);
          const contextCheck = isConversationSuitableForSale(user, intentData, user.recentMessages);
        
        console.log(`   Context: ${contextCheck.suitable ? '✅ PASS' : '❌ BLOCKED'}`);
        console.log(`   Reason: ${contextCheck.reason}`);
        
        if (contextCheck.suitable || timingCheck.force) {
          // Check confidence threshold
          if (selectedStrategy.confidence >= 0.6 || timingCheck.force) {
            strategy = "repeat_sale";
            user.conversation_mode = "selling";
            console.log(`\n✅ Repeat sale APPROVED`);
          } else {
            console.log(`\n⚠️  Low confidence (${selectedStrategy.confidence}) - skipping sale`);
          }
        } else {
          console.log(`\n⏸️  Sale blocked by context`);
        }
      } else {
        console.log(`\n⏸️  Sale blocked by timing`);
      }
    }
    
    console.log(`=== END REPEAT SALE ANALYSIS ===\n`);
    } // End wind-down check
  }

  // ✅ INCREMENT COUNTERS IF SALE APPROVED
  if (strategy === "first_sale" || strategy === "repeat_sale") {
    onSaleAttempt(user.state);
    user.has_asked_support = true;
    user.state.lastSaleMessageCount = user.message_count; // Track message count at sale
    
    console.log(`📊 Sale attempt logged`);
    console.log(`   Weekly: ${user.state.weeklySaleAttempts}/3`);
    console.log(`   Total: ${user.state.totalSaleAttempts}`);
    console.log(`   Casual attempts: ${user.state.casualSaleAttempts}/2`);
  }

  /* ========= BUILD PROMPT + CALL AI ========= */
  let replyText;

  if (modelChoice === "openai") {
    replyText = await callOpenAI(
      buildOpenAIPrompt(user, strategy),
      text
    );
  } else {
    // Pass selectedStrategy to buildGrokPrompt for repeat sales
    replyText = await callGrok(
      buildGrokPrompt(user, strategy, selectedStrategy),
      buildContextPrompt(user, strategy, getTimeContext()),
      text
    );
  }

  // Parse asset markers from AI response
  const assetMarkers = parseAssetMarkers(replyText);
  const cleanReplyText = assetMarkers.cleanResponse;

  /* ========= SEND MESSAGE ========= */
  await sendBurstReplies(user, chatId, cleanReplyText);

  // Send asset if present (block during wind-down unless selling)
  if (assetMarkers.hasAsset && 
      !(user.wind_down && user.conversation_mode !== "selling")) {
    // Strategy already selected by AI based on REPEATED_SALE_GUIDE
    // Asset markers in reply will match the selected strategy
    const strategyId = 0; // Not needed - AI handles strategy selection
    
    await sleep(1500);
    
    const assetData = getAssetToSend(assetMarkers, strategyId, chatId);
    
    if (assetData) {
      const { asset, shouldScheduleConfirmation, shouldSendImage } = assetData;
      
      if (shouldSendImage) {
        await sendUploadPhoto(chatId);
        await sleep(800);
        
        const sendResult = await sendAsset(chatId, asset);
        
        if (sendResult && sendResult.ok) {
          console.log(`✅ Sent ${asset.type} (${asset.assetId}) to ${chatId}`);
          if (selectedStrategy) {
            console.log(`   Strategy: ${selectedStrategy.strategy}`);
          }
        } else {
          console.error('❌ Failed to send asset:', asset.assetId);
        }
      }
      
      if (shouldScheduleConfirmation && user.state.totalSaleSuccess > 0) {
        const confirmation = scheduleConfirmation(chatId, asset.assetId, asset);
        if (confirmation) {
          console.log(`📅 Scheduled ${confirmation.confirmationAssetId} for ${confirmation.delayMs / 60000} minutes`);
        }
      }
    }
  }

  // ✅ MARK HAS_ASKED_SUPPORT if bot actually asked
  if (
    (strategy === "first_sale" || strategy === "repeat_sale") &&
    botAskedForSupport(cleanReplyText)
  ) {
    user.has_asked_support = true;
    
    // Move to Stage 6 (waiting for response)
    if (user.stages.current === 5) {
      updateStage(user, 6, "Sale asked, awaiting response");
    }
    
    console.log(`🎯 Bot asked for support in message`);
  }

  /* ========= SAVE BOT REPLY ========= */
  user.recentMessages.push(`Aurelia: ${cleanReplyText}`);
  if (user.recentMessages.length > 12) {
    user.recentMessages.shift();
  }

  /* ========= WIND-DOWN TRACKING & AUTO-EXIT ========= */
  if (user.wind_down && user.conversation_mode !== "selling") {
    user.wind_down_messages_sent = (user.wind_down_messages_sent || 0) + 1;
    console.log(`🌙 Wind-down message sent (${user.wind_down_messages_sent}/3)`);
    
    // Auto-exit after 3 messages
    if (user.wind_down_messages_sent >= 3) {
      console.log(`🌙 Wind-down complete - setting to resting mode`);
      user.conversation_mode = "resting";
      user.wind_down = false;
      user.wind_down_messages_sent = 0;
    }
  }
  
  // If sale just ended during deep_night, add wrap-up and rest
  if (timeContext === "deep_night" && 
      strategy === "repeat_sale" &&
      user.conversation_mode === "selling") {
    console.log(`🌙 Sale completed during deep_night - will rest after wrap-up`);
    // Sale mode will continue until next message, then bot can say goodnight
  }

  /* ========= FIRST REPLY FLAG ========= */
  if (!user.firstReplySent) {
    user.firstReplySent = true;
  }

  // Log state summary
  const summary = getStateSummary(user.state);
  console.log(`📊 User ${chatId}:`, summary);
  console.log(`🎭 Stage: ${user.stages.current}, Completed: [${user.stages.completed.join(', ')}]`);

  res.sendStatus(200);
});

/* ================== CONFIRMATION CHECKER ================== */
async function checkAndSendPendingConfirmations() {
  for (const chatId in users) {
    const pending = getPendingConfirmations(chatId);
    
    for (const confirmation of pending) {
      try {
        await sendUploadPhoto(chatId);
        await sleep(1000);
        
        const result = await sendAsset(chatId, confirmation.asset);
        
        if (result && result.ok) {
          console.log(`✅ Sent delayed confirmation to ${chatId}`);
          await sendBurstReplies(users[chatId], chatId, "Look what I got! 💕 Thank you so much~");
        }
      } catch (error) {
        console.error(`❌ Error sending confirmation to ${chatId}:`, error);
      }
    }
  }
}

setInterval(checkAndSendPendingConfirmations, 5 * 60 * 1000);

/* ================== SERVER ================== */
app.listen(port, () => {
  console.log("Aurelia is running on port", port);
});

export {
  buildContextPrompt,
  buildOpenAIPrompt,
  buildGrokPrompt
};
