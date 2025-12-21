const express = require("express");
const fetch = require("node-fetch");

const userState = {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const app = express();
const PORT = process.env.PORT || 3000;

// cho phép đọc JSON từ Telegram
app.use(express.json());

// route test
app.get("/", (req, res) => {
  res.send("Bot is running");
});

// HÀM TÍNH DELAY
function calculateDelay(chatId, replyText) {
  const now = Date.now();

  if (!userState[chatId]) {
    userState[chatId] = {
      firstSeen: now,
      lastReply: now,
      messageCount: 1
    };

    // tin đầu tiên: 3–5 phút
    return 180000 + Math.random() * 120000;
  }

  userState[chatId].messageCount++;

  const baseDelay = 800;
  const typingDelay = Math.min(
    5000,
    replyText.length * (40 + Math.random() * 30)
  );

  const randomHuman = Math.random() * 800;

  return baseDelay + typingDelay + randomHuman;
}

// webhook telegram
app.post("/webhook", async (req, res) => {
  console.log("📩 TELEGRAM UPDATE:");
  console.log(JSON.stringify(req.body, null, 2));

  const message = req.body.message;
  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const text = message.text;

  app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  const replyText = `Mình nhận được rồi nè: ${text}`;

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

// start server (CHỈ 1 LẦN)
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
