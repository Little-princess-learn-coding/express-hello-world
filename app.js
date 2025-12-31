import express from "express";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Call Grok
async function callGrok(systemPrompt, contextPrompt, userMessage) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.XAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "grok-2-latest",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: contextPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.95,
      max_tokens: 500
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

// ================= USER STATE =================
const users = {};

function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = {
      chatId,
      state: "stranger", // stranger | casual | supporter_once | time_waster
      relationship_level: 0,
      message_count: 0,
      last_sale_time: null,
      failed_sale_count: 0,
      conversationClosed: false,
      created_at: Date.now(),
      last_active: Date.now()
    };
  }
  return users[chatId];
}

function updateUser(chatId, updates = {}) {
  const user = getUser(chatId);
  Object.assign(user, updates);
  user.last_active = Date.now();
  return user;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// PHÂN LOẠI INTENT
async function classifyIntent(userMessage, recentMessages = []) {
  const prompt = `
You are analyzing a chat message.

User message:
"${userMessage}"

Recent context:
${recentMessages.join("\n")}

Classify the user's intent.

Possible intents:
- flirty
- interested
- supportive
- neutral
- bored
- avoiding_sale
- goodbye

Answer ONLY JSON:
{
  "intent": "one_of_the_above",
  "confidence": 0.0-1.0
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
    return { intent: "neutral", confidence: 0.5 };
  }
}


// ÁNH XẠ INTENT
function applyIntentToUser(user, intent) {
  switch (intent) {
    case "flirty":
      user.relationship_level += 2;
      user.state = "casual";
      break;

    case "interested":
      user.relationship_level += 1;
      break;

    case "supportive":
      user.relationship_level += 2;
      user.state = "supporter_once";
      break;

    case "bored":
      user.relationship_level -= 1;
      break;

    case "avoiding_sale":
      user.failed_sale_count += 1;
      break;

    case "goodbye":
      user.conversationClosed = true;
      break;

    default:
      break;
  }

  // clamp cho an toàn
  user.relationship_level = Math.max(0, Math.min(10, user.relationship_level));
}

// ================= SALE DECISION LOGIC =================

function canAttemptSale(user) {
  const now = Date.now();

  // chưa đủ thân
  if (user.relationship_level < 5) return false;

  // người lạ thì cấm bán
  if (user.state === "stranger") return false;

  // bị gắn mác time_waster
  if (user.state === "time_waster") return false;

  // cooldown sau khi bán
  if (user.last_sale_time && now - user.last_sale_time < 6 * 60 * 60 * 1000)
    return false;

  // bán fail nhiều lần
  if (user.failed_sale_count >= 2) return false;

  return true;
}

function chooseSaleStrategy(user) {
  // sale đầu
  if (user.state === "casual") return "soft_support_hint";

  // đã từng ủng hộ
  if (user.state === "supporter_once") return "warm_return_offer";

  // fallback
  return null;
}

// Context prompt
function buildContextPrompt(user) {
  const saleAllowed = canAttemptSale(user);
  const strategy = saleAllowed ? chooseSaleStrategy(user) : null;

  return `
USER STATE:
- relationship_state: ${user.state}
- relationship_level: ${user.relationship_level}
- failed_sale_count: ${user.failed_sale_count}
- last_sale_time: ${user.last_sale_time}

SALE RULES:
- Sale allowed: ${saleAllowed}
- Sale strategy: ${strategy || "none"}

${strategy ? SALE_STRATEGIES[strategy] : ""}

IMPORTANT:
- If Sale allowed is false, do NOT mention Ko-fi or selling.
- If allowed, integrate naturally into conversation.
- Never break character.
`;
}

// Hàm delay
function calculateDelay(chatId, replyText) {
  if (!userState[chatId]) {
    userState[chatId] = {
      firstSeen: Date.now(),
      messageCount: 0
    };
    userState[chatId].messageCount++;
    return 180000 + Math.random() * 120000; // 3–5 minutes
  }

  userState[chatId].messageCount++;

  const baseDelay = 800;
  const typingDelay = Math.min(5000, replyText.length * 50);
  const randomHuman = Math.random() * 800;

  return baseDelay + typingDelay + randomHuman;
}

function getUserLevel(chatId) {
  const count = userState[chatId]?.messageCount || 0;

  if (count <= 5) return "stranger";
  if (count <= 10) return "casual";
  return "familiar";
}

// health check
app.get("/", (req, res) => {
  res.send("Bot is running");
});

// webhook telegram
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  const state = getUserState(chatId);
  state.messageCount++;
  state.lastMessageAt = Date.now();

  // typing
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendChatAction`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        action: "typing"
      })
    }
  );

  const delay = calculateDelay(chatId, replyText);
  await sleep(delay);

  // send message
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: replyText
      })
    }
  );
  res.sendStatus(200);
});

  // detect if sale happened
if (canAttemptSale(user)) {
  const strategy = chooseSaleStrategy(user);
  if (strategy) {
    updateUser(chatId, {
      last_sale_time: Date.now()
    });
  }
}
  // User respond to sale
  updateUser(chatId, {
  state: "supporter_once",
  failed_sale_count: 0
});
  updateUser(chatId, {
  failed_sale_count: user.failed_sale_count + 1
});
  updateUser(chatId, {
  state: "time_waster"
});


// Hàm tách câu
function splitIntoBursts(text) {
  // ưu tiên tách theo xuống dòng trước
  let parts = text.split(/\n+/).map(p => p.trim()).filter(Boolean);

  if (parts.length > 1) return parts;

  // nếu không có xuống dòng → tách theo dấu câu
  parts = text.split(/(?<=[.!?~💕🥰😊])/);

  return parts
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .slice(0, 4); // giới hạn tối đa 4 burst
}

async function sendBurstReplies(chatId, bursts) {
  for (let i = 0; i < bursts.length; i++) {
    const text = bursts[i];

    // typing cho từng burst
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

    const delay = 600 + Math.random() * 1200;
    await sleep(delay);

    await sendMessage(chatId, text);
  }
}

// Hàm phát hiện “kết thúc hội thoại”
function isConversationEnding(text) {
  const endings = [
    "going to sleep",
    "talk later",
    "busy now",
    "catch up later",
    "good night",
    "see you later",
  ];

  return endings.some((phrase) =>
    text.toLowerCase().includes(phrase)
  );
}

// CHỈ 1 app.listen
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
