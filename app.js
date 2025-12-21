const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// cho phép đọc JSON từ Telegram
app.use(express.json());

// route test
app.get("/", (req, res) => {
  res.send("Bot is running");
});

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

  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_AURELIABOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Mình nhận được rồi nè: ${text}`,
      }),
    }
  );

  res.sendStatus(200);
});

// start server (CHỈ 1 LẦN)
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
