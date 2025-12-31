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

      // activity
      message_count: 0,
      created_at: Date.now(),
      last_active: Date.now(),

      // ⬇️ thêm cho delay & realism
      firstReplySent: false,   // CHÌA KHOÁ delay 3–5 phút
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
async function classifyIntent(text) {
  const prompt = `
Classify intent of the message below.

Message:
"${text}"

Intents:
- flirty
- supportive
- interested
- neutral
- bored
- avoiding_sale
- goodbye

Reply ONLY JSON:
{ "intent": "one", "confidence": 0.0-1.0 }
`;

  const result = await callGrok(
    "You are a strict intent classifier.",
    "",
    prompt
  );

  try {
    return JSON.parse(result);
  } catch {
    return { intent: "neutral", confidence: 0.5 };
  }
}

function applyIntent(user, intent) {
  switch (intent) {
    case "flirty":
      user.relationship_level += 2;
      user.state = "casual";
      break;
    case "supportive":
      user.relationship_level += 2;
      break;
    case "interested":
      user.relationship_level += 1;
      break;
    case "avoiding_sale":
      user.failed_sale_count += 1;
      break;
    case "goodbye":
      user.conversationClosed = true;
      break;
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
- minimal emoji (🥰💕😈🥺^^ only when needed)
Never say "hey".
Never sound needy or toxic.
`;

function buildContextPrompt(user, strategy) {
  return `
USER STATE:
- state: ${user.state}
- relationship_level: ${user.relationship_level}
- failed_sale_count: ${user.failed_sale_count}

SALE:
- allowed: ${!!strategy}
- strategy: ${strategy || "none"}

Follow guide path rules strictly.
If sale is not allowed, NEVER mention Ko-fi or albums.
`;
}

/* ================== TELEGRAM WEBHOOK ================== */
app.post("/webhook", async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text;

  const user = getUser(chatId);
  user.message_count++;

  const intentData = await classifyIntent(text);
  applyIntent(user, intentData.intent);

  const strategy = canAttemptSale(user)
    ? chooseSaleStrategy(user)
    : null;

  const reply = await callGrok(
    SYSTEM_PROMPT,
    buildContextPrompt(user, strategy),
    text
  );

  if (strategy) {
    updateUser(chatId, { last_sale_time: Date.now() });
  }

  await sendBurstReplies(chatId, reply);
  if (!user.firstReplySent) {
    user.firstReplySent = true;
  }
  
  res.sendStatus(200);
});

/* ================== SERVER ================== */
app.listen(port, () => {
  console.log("Aurelia is running on port", port);
});
