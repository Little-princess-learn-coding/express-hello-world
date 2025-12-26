const express = require("express");
const fetch = require("node-fetch");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// trạng thái user
const userState = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getUserState(chatId) {
  if (!userStates[chatId]) {
    userStates[chatId] = {
      stage: "intro",
      messageCount: 0,
      lastMessageAt: Date.now(),
      isFirstContact: true,
    };
  }
  return userStates[chatId];
}

function calculateDelay(chatId, replyText) {
  const now = Date.now();

  if (!userState[chatId]) {
    userState[chatId] = {
      firstSeen: now,
      messageCount: 1
    };
    return 180000 + Math.random() * 120000; // 3–5 phút
  }
  
// Xếp loại thân mật
function getUserLevel(chatId) {
  const count = userState[chatId]?.messageCount || 0;

  if (count <= 5) return "stranger";
  if (count <= 10) return "casual";
  return "familiar";
}

  userState[chatId].messageCount++;

  const baseDelay = 800;
  const typingDelay = Math.min(5000, replyText.length * 50);
  const randomHuman = Math.random() * 800;

  return baseDelay + typingDelay + randomHuman;
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

  // ENDING DETECT
  if (isConversationEnding(text)) {
    state.stage = "inactive";
    await sendMessage(chatId, "Alright, talk later 🙂");
    return res.sendStatus(200);
  }

  // STAGE LOGIC
  if (state.stage === "intro") {
    state.stage = "connect";
    state.isFirstContact = false;
    await sendMessage(chatId, "Hey 🙂 nice to meet you.");
  } 
  else if (state.stage === "connect") {
    await sendMessage(chatId, "I see 👀 tell me more.");
  }

  res.sendStatus(200);
});

  // Nội dung reply theo mức độ thân mật
  const level = getUserLevel(chatId);

let replyText;

if (level === "stranger") {
  replyText = "Hi~ where r u from?";
}
else if (level === "casual") {
  replyText = "Oh okay, I get what you mean 💕";
}
else {
  replyText = "Haha yeah 😄 I know what you’re talking about. Go on.";
}

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
