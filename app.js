import express from "express";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

/* ================== GROK CALL ================== */
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

/* ================== USER STATE ================== */
const users = {};

function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = {
      chatId,

      // state machine
      state: "stranger", // stranger | casual | supporter_once | time_waster
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
      conversationClosed: false
    };
  }
  return users[chatId];
}

function updateUser(chatId, updates) {
  Object.assign(users[chatId], updates);
  users[chatId].last_active = Date.now();
}

/* ================== UTILS ================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function calculateDelay(chatId, replyText) {
  const user = userState[chatId];
  const now = Date.now();

  // first contact: 3–5 minutes
  if (!user.firstReplySent) {
    return 180000 + Math.random() * 120000; // 3–5 phút
  }

  // normal human typing delay
  const base = 600;
  const perChar = 35;
  const random = Math.random() * 800;
  const max = 5000;

  return Math.min(base + replyText.length * perChar + random, max);
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

async function sendBurstReplies(chatId, text) {
  const parts = splitIntoBursts(text);

  for (let i = 0; i < parts.length; i++) {
    await sendTyping(chatId);

    const delay = calculateDelay(parts[i]);
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
  "saleResponse": "none | interested | hesitant | rejected"
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

function applyIntent(user, intentData) {
  const { intent, mood, saleResponse } = intentData;

  if (intent === "flirt" || intent === "horny") {
    user.relationship_level += 2;
    user.state = "casual";
  }

  if (intent === "care") {
    user.relationship_level += 1;
  }

  if (saleResponse === "rejected") {
    user.failed_sale_count += 1;
  }

  if (intent === "goodbye" || mood === "tired") {
    user.conversationClosed = true;
  }

  user.relationship_level = Math.min(10, Math.max(0, user.relationship_level));
}


/* ================== SALE LOGIC ================== */
function canAttemptSale(user) {
  if (user.state === "stranger") return false;
  if (user.state === "time_waster") return false;
  if (user.relationship_level < 5) return false;

  if (
    user.last_sale_time &&
    Date.now() - user.last_sale_time < 6 * 60 * 60 * 1000
  )
    return false;

  if (user.failed_sale_count >= 3) {
    user.state = "time_waster";
    return false;
  }

  return true;
}

function chooseSaleStrategy(user) {
  if (user.state === "casual") return "sale_second_or_more";
  if (user.state === "supporter_once") return "return_support";
  return null;
}

/* ================== PROMPT ================== */
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

Relationship state: ${user.state}
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

/* ================== TELEGRAM WEBHOOK ================== */
app.post("/webhook", async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text;

  const user = getUser(chatId);
  // reset weekly sale count mỗi 7 ngày
  if (Date.now() - user.weekly_reset_at > 7 * 24 * 60 * 60 * 1000) {
  user.weekly_sale_count = 0;
  user.weekly_reset_at = Date.now();
}
  user.message_count++;
  user.last_active = Date.now();

  /* ========= 1️⃣ SAVE USER MESSAGE (SHORT MEMORY) ========= */
  user.recentMessages.push(`User: ${text}`);
  if (user.recentMessages.length > 12) {
    user.recentMessages.shift();
  }

  /* ========= 2️⃣ EXTRACT MEMORY FACTS ========= */
  try {
    const extractedFacts = await extractUserFacts(text);
    for (const key in extractedFacts) {
      if (extractedFacts[key] && !user.memoryFacts[key]) {
        user.memoryFacts[key] = extractedFacts[key];
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

  /* ========= 4️⃣ SALE DECISION ========= */
  const strategy = canAttemptSale(user)
    ? chooseSaleStrategy(user, intentData)
    : null;

  /* ========= 5️⃣ BUILD CONTEXT + CALL AI ========= */
  const replyText = await callGrok(
    SYSTEM_PROMPT,
    buildContextPrompt(user, strategy),
    text
  );

  if (strategy) {
    user.last_sale_time = Date.now();
  }

  /* ========= 6️⃣ SEND MESSAGE (typing + delay + burst) ========= */
  await sendBurstReplies(chatId, replyText);

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
