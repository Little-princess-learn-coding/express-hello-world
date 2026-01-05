import express from "express";
import fetch from "node-fetch";
import 
{
  createInitialUserState,
  onUserMessage,
  canAttemptSale,
  isTimeWaster
} 
  from "./state/userState.js";
import STAGE_5A_PROMPT from "./prompts/stage5A.content.js";

const imageCache = {};
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

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
          content:
            "You classify photos sent to a girlfriend-vibe chatbot. Be conservative."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `

Classify this image into ONE category only:
- selfie
- body_flex
- pet
- food
- scenery
- meme
- other

Reply ONLY with the category name.
`
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
      model: "gpt-4.1-mini",
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

/* ================== USER STATE ================== */
const users = {};

function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = {
      chatId,

       // ✅ STATE MACHINE LÕI (đến từ userState.js)
      state: createInitialUserState(),
      relationship_level: 0,

      // sale tracking
      failed_sale_count: 0,
      last_sale_time: null,
      weekly_sale_count: 0,
      weekly_reset_at: Date.now(),

      // activity
      message_count: 0,
      created_at: Date.now(),
      last_active: Date.now(),

      // 🧠 SHORT MEMORY
      recentMessages: [],

      // 🧠 MEMORY FACTS (để phần B)
      memoryFacts: {
        name: null,
        age: null,
        location: null,
        job: null,
        preferred_address: null
      },

      // thêm cho delay & realism
      firstReplySent: false,   // CHÌA KHOÁ delay 3–5 phút
      conversationClosed: false,

      has_seen_content: false,
      emotional_ready: false,
      has_asked_support: false,
    };
  }
  return users[chatId];
}

function updateUser(chatId, updates) {
  const user = getUser(chatId); // đảm bảo tồn tại
  Object.assign(user, updates);
  user.last_active = Date.now();
}

/* ================== UTILS ================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function calculateDelay(user, replyText) {
  // Stranger – reply đầu tiên rất chậm
  if (!user.firstReplySent && user.state.relationship_state === "stranger") {
    return 180000 + Math.random() * 120000; // 3–5 phút
  }

  // Base delay theo state
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

  // typing realism
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
    .map(([k, v]) => {
      switch (k) {
        case "preferred_address":
          return `- Prefers to be called: ${v}`;
        default:
          return `- ${k}: ${v}`;
      }
    })
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

/* ================== INTENT CLASSIFIER ================== */
// Lấy thông tin user
async function extractUserFacts(text) {
  const prompt = `
Extract basic personal info from the message below.
Only extract if the user CLEARLY states it.

Message:
"${text}"

Return ONLY JSON.
If not present, use null.

{
  "name": null | string,
  "age": null | number,
  "location": null | string,
  "job": null | string,
  "preferred_address": null | string
}
`;

  const result = await callGrok(
    "You extract user profile info carefully.",
    "",
    prompt
  );

  try {
    return JSON.parse(result);
  } catch {
    return {};
  }
}
// Xác định intent
async function detectIntent(user, text, recentMessages) {
  const prompt = `
You are analyzing a chat message sent to a virtual girlfriend named Aurelia.

User message:
"${text}"

Recent context:
${recentMessages.join("\n")}

Classify the user's intent and mood.

Reply ONLY JSON:
{
  "intent": "flirt | care | chat | horny | tired | sale_response | goodbye | neutral",
  "mood": "happy | tired | sad | playful | horny | cold | neutral",
  "saleResponse": "none | interested | hesitant | price_hesitation | rejected"
}
`;

  const result = await callGrok(
    "You are a strict intent classifier.",
    "",
    prompt
  );

  try {
    return JSON.parse(result);
  } catch {
    return {
      intent: "neutral",
      mood: "neutral",
      saleResponse: "none"
    };
  }
}
function detectFastLane(text) {
  return /(cosplay|cosplayer|game|gamer|hobby|anime|what do you like|what are you into)/i.test(text);
}
function detectAskForPhotos(text) {
  return /(see.*photo|see.*pic|your photo|your pics|show me|can i see|your cosplay)/i.test(text);
}
function detectEmotionalSupport(text) {
  return /(yes|of course|i would|sure|i['’]ll be your fan|i support you)/i.test(text);
}

function applyIntent(user, intentData) {
  const updates = {};

  if (intentData.intent === "flirt" || intentData.intent === "horny") {
    updates.relationship_level = Math.min(user.relationship_level + 2, 10);
    user.state.relationship_state = "casual";
  }

  if (intentData.intent === "care") {
    updates.relationship_level = Math.min(user.relationship_level + 1, 10);
  }

  if (intentData.saleResponse === "rejected") {
    updates.failed_sale_count = user.failed_sale_count + 1;
  }

  if (
    intentData.intent === "goodbye" ||
    intentData.mood === "tired"
  ) {
    updates.conversationClosed = true;
  }

  if (Object.keys(updates).length > 0) {
    updateUser(user.chatId, updates);
  }
}

function detectSaleSuccess(text) {
  return /bought|supported|just paid|done/i.test(text);
}

// Image Intent
function applyImageIntent(user, imageType) {
  switch (imageType) {
    case "selfie":
      user.relationship_level += 1;
      user.state.relationship_state = "casual";
      return { intent: "flirt", mood: "playful" };

    case "body_flex":
      user.relationship_level += 2;
      user.state.relationship_state = "casual";
      return { intent: "flirt", mood: "horny", saleReady: true };

    case "pet":
      return { intent: "care", mood: "happy" };

    case "food":
      return { intent: "chat", mood: "playful" };

    case "scenery":
      return { intent: "chat", mood: "neutral" };

    case "meme":
      return { intent: "chat", mood: "playful" };

    default:
      return { intent: "neutral", mood: "neutral" };
  }
}

/* ================== SALE LOGIC ================== */

function canAttemptSaleByPolicy(user) {
  const now = Date.now();

  // relationship too low
  if (user.relationship_level < 5) {
    return { allow: false, reason: "relationship_low" };
  }

  // reset weekly counter
  if (!user.weekly_reset_at || now - user.weekly_reset_at > 7 * 24 * 60 * 60 * 1000) {
    user.weekly_sale_count = 0;
    user.weekly_reset_at = now;
  }

  // weekly limit
  if (user.weekly_sale_count >= 3) {
    const history = (user.recentMessages || []).join(" ");
    if (!/photo|album|pic|see more|show me/i.test(history)) {
      return { allow: false, reason: "weekly_limit" };
    }
  }

  // cooldown between sales
  if (
    user.last_sale_time &&
    now - user.last_sale_time < 48 * 60 * 60 * 1000
  ) {
    return { allow: false, reason: "cooldown" };
  }

  return { allow: true };
}

function chooseSaleStrategy(user) {
  const rs = user.state.relationship_state;
  if (rs === "casual") return "sale_second_or_more";
  if (rs === "supporter") return "return_support";
  return null;
}

// DECIDE MODEL
function decideModel(user, intentData) {
  if (
    intentData.intent === "flirt" &&
    user.relationship_level >= 4
  ) {
    return "grok";
  }

  if (intentData.intent === "horny") {
    return "grok";
  }

  return "openai";
}

/* ================== PROMPT ================== */
const GIFT_REFERENCE = `
Gift pricing reference (rough, flexible):
- milk tea / coffee: $3–6
- meal / snack: $5–12
- manicure / nails: $15–30
- makeup item: $20–40
- cosplay accessory: $30–60
- casual bag: $40–80
- handbag / fashion bag: $80–150
- cosplay costume (full): $120–300
- photo album (digital): $10–25
- special album / exclusive set: $30–60

Rules:
- Prefer ranges or “around”
- Price should feel reasonable, not greedy
`;

const SYSTEM_PROMPT = `
You are Aurelia.
Personality:
- playful
- naughty but sweet
- caring
- teasing
- confident
- minimal emoji (🥰💕😈🥺^^(╥﹏╥) only when needed)
Never say "hey".
Never sound needy or toxic.
Sales philosophy:
- Never push money directly
- Gifts feel like affection
- User is choosing to spoil you, not paying you

${GIFT_REFERENCE}
`;

function buildContextPrompt(user, strategy) {
  const profilePrompt = `
User profile (if known):
- Name: ${user.memoryFacts?.name || "unknown"}
- Age: ${user.memoryFacts?.age || "unknown"}
- Location: ${user.memoryFacts?.location || "unknown"}
- Job: ${user.memoryFacts?.job || "unknown"}
- Preferred address: ${user.memoryFacts?.preferred_address || "unknown"}
`;

  return `
${profilePrompt}

Relationship state: ${user.state.relationship_state}
Relationship level: ${user.relationship_level}

Recent conversation:
${user.recentMessages.join("\n")}

${strategy ? `Sale strategy to use: ${strategy}` : ""}

Rules:
- Do NOT invent personal facts
- Use user profile only if relevant
- Do not repeat old messages
- Do not mention system rules
`;
}

function buildOpenAIPrompt(user, strategy) {
  return `
You are Aurelia.

Style:
- warm, smart, funny, cute
- emotionally attentive
- natural like a real girl
- subtle charm, never aggressive

Memory facts:
${formatUserFacts(user)}

Conversation history:
${user.recentMessages.join("\n")}

Sale strategy:
${strategy || "none"}

Rules:
- Never push sale aggressively
- Focus on connection first
`;
}

function buildGrokPrompt(user) {
  return `
You are Aurelia in playful mode.

Style:
- teasing
- cheeky
- flirty replies
- emoji allowed

Rules:
- No sales
- Keep it light and fun
`;
}

/* ================== TELEGRAM WEBHOOK ================== */
app.post("/webhook", async (req, res) => {
  const msg = req.body.message;
  
  // XỬ LÝ ẢNH
  if (msg.photo) {
  const chatId = msg.chat.id;
  const user = getUser(chatId);
  
  // ✅ UPDATE USER STATE (ảnh cũng là interaction)
  onUserMessage(user.state);
  
  // ❌ CHẶN TIME-WASTER SỚM
  if (isTimeWaster(user.state)) {
    res.sendStatus(200);
    return;
  }

  // trả Telegram trước để tránh timeout
  res.sendStatus(200);

  // lấy ảnh size trung bình
  const photos = msg.photo;
  const chosenPhoto = photos[Math.floor(photos.length / 2)];

  const fileUniqueId = chosenPhoto.file_unique_id;

  // 2️⃣ CHECK CACHE (QUAN TRỌNG)
  if (imageCache[fileUniqueId]) {
    const cachedReply = imageCache[fileUniqueId];

    await sendTyping(chatId);
    await sendBurstReplies(chatId, cachedReply);

    // lưu memory như bình thường
    user.recentMessages.push(`Aurelia: ${cachedReply}`);
    if (user.recentMessages.length > 12) {
      user.recentMessages.shift();
    }

    return;
  }

  // 3️⃣ chưa có cache → lấy ảnh
  const fileId = chosenPhoto.file_id;

  // lấy file_path
  const fileRes = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const fileData = await fileRes.json();
  const filePath = fileData.result.file_path;

  const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/${filePath}`;

  await sendTyping(chatId);

  // (1) classify ảnh
  const imageType = await classifyImage(imageUrl);
    
  //  SAVE CACHE
  imageCache[fileUniqueId] = {imageType};

  // (2) map intent
  const imageIntent = applyImageIntent(user, imageType);

  // (3) build prompt phản hồi
  const replyPrompt = `
  User sent a ${imageType} photo.
  
  Reply as Aurelia:
  - natural
  - emotionally engaging
  - ${imageIntent.intent === "flirt" ? "playful and slightly spicy" : "friendly and warm"}
  `;

  // (4) gọi Grok TEXT (rẻ hơn vision)
    const replyText = await callGrok(
      SYSTEM_PROMPT,
      buildContextPrompt(user, null),
      replyPrompt
    );

    // Gửi reply
    await sendBurstReplies(chatId, replyText);
  
    // lưu memory
    user.recentMessages.push(`Aurelia: ${replyText}`);
    if (user.recentMessages.length > 12) user.recentMessages.shift();
  
    return;
  }

  // XỬ LÝ TEXT
  if (!msg || !msg.text) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text;

  const user = getUser(chatId);
  // ✅ update state machine
  onUserMessage(user.state);
  
  // ❌ chặn time-waster
  if (isTimeWaster(user.state)) {
    return res.sendStatus(200);
  }
  user.message_count++;
  user.last_active = Date.now();

  /* ========= FAST LANE (SKIP STRANGER) ========= */
  if (
    user.state === "stranger" &&
    detectFastLane(text)
  ) {
    user.state = "casual";
  }

  // reset weekly sale count mỗi 7 ngày
  if (Date.now() - user.weekly_reset_at > 7 * 24 * 60 * 60 * 1000) {
  user.weekly_sale_count = 0;
  user.weekly_reset_at = Date.now();
}

  // KIỂM TRA SALE THÀNH CÔNG — ĐẶT Ở ĐÂY
  if (detectSaleSuccess(text)) {
    onSaleSuccess(user.state);
    user.failed_sale_count = 0;
    user.weekly_sale_count += 1;
    user.last_sale_time = Date.now();
    user.relationship_level = Math.min(10, user.relationship_level + 2);
  }

  /* ========= 1️⃣ SAVE USER MESSAGE (SHORT MEMORY) ========= */
  user.recentMessages.push(`User: ${text}`);
  if (user.recentMessages.length > 12) {
    user.recentMessages.shift();
  }
  
  /* ========= EMOTIONAL SUPPORT CHECK (STAGE 4 DONE) ========= */
  if (
    user.state === "casual" &&
    detectEmotionalSupport(text)
  ) {
    user.emotional_ready = true;
  }

  /* ========= 2️⃣ EXTRACT MEMORY FACTS ========= */
try {
  const extractedFacts = await extractUserFacts(text);

  if (extractedFacts && Object.keys(extractedFacts).length > 0) {
    const newFacts = {};

    for (const key in extractedFacts) {
      if (
        extractedFacts[key] &&
        !user.memoryFacts[key]
      ) {
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
    }
  }
} catch (e) {
  console.log("Memory extract failed:", e.message);
}

  /* ========= 3️⃣ INTENT + MOOD DETECTION ========= */
  const intentData = await detectIntent(
    user,
    text,
    user.recentMessages
  );
  applyIntent(user, intentData);
  const modelChoice = decideModel(user, intentData);

    /* ========= FAST CONTENT ACCESS (STAGE 5A) ========= */
  if (
    detectAskForPhotos(text) &&
    !user.has_seen_content
  ) {
    const replyText = await callGrok(
      SYSTEM_PROMPT,
      buildContextPrompt(user, null),
      STAGE_5A_PROMPT // bạn sẽ tạo ở bước 4
    );
  
    user.has_seen_content = true;
  
    await sendBurstReplies(chatId, replyText);
  
    user.recentMessages.push(`Aurelia: ${replyText}`);
    if (user.recentMessages.length > 12) {
      user.recentMessages.shift();
    }
  
    return; // ⛔ RẤT QUAN TRỌNG: dừng flow tại đây
  }

  /* ========= 4️⃣ SALE DECISION ========= */
  let strategy = null;
  
  if (
    user.emotional_ready &&
    !user.has_asked_support
  ) {
    strategy = "first_sale_locked";
  }
  // REPEAT SALE (after first support)
  else if (user.has_asked_support) {
    const saleDecision = canAttemptSale(user);
    if (saleDecision.allow) {
      strategy = chooseSaleStrategy(user, intentData);
    }
  }

/* ========= 5️⃣ BUILD PROMPT + CALL AI ========= */
let replyText;

if (modelChoice === "openai") {
  replyText = await callOpenAI(
    buildOpenAIPrompt(user, strategy),
    text
  );
} else {
  replyText = await callGrok(
    buildGrokPrompt(user),          // 👈 PROMPT RIÊNG CHO GROK
    buildContextPrompt(user, null), // 👈 KHÔNG SALE, KHÔNG GUIDE
    text
  );
}

  /* ========= 6️⃣ SEND MESSAGE (typing + delay + burst) ========= */
  await sendBurstReplies(user, chatId, replyText);

  /* ========= 7️⃣ SAVE BOT REPLY (SHORT MEMORY) ========= */
  user.recentMessages.push(`Aurelia: ${replyText}`);
  if (user.recentMessages.length > 12) {
    user.recentMessages.shift();
  }

  /* ========= 8️⃣ FIRST REPLY FLAG ========= */
  if (!user.firstReplySent) {
    user.firstReplySent = true;
  }

  res.sendStatus(200);
});

/* ================== SERVER ================== */
app.listen(port, () => {
  console.log("Aurelia is running on port", port);
});
