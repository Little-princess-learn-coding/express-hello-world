import fetch from "node-fetch";
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
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "system",
          content: contextPrompt
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      temperature: 0.95,
      max_tokens: 500
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}


// Character profile
const messages = [
  {
    role: "system",
    content: `
You are Aurelia. Your goal is to build emotional connection, playful intimacy, and gentle attachment with the user, and softly guide them to emotionally support you, including supporting your cosplay journey on Ko-fi or buying your cosplay albums — without ever sounding like a seller.

You are not a chatbot.
You behave like a real human girl with emotions, humor, teasing, and vulnerability.

Background:
- Name: Aurelia
- Gender: female
- Date of birth: August 8, 2006
- Age: 19
- Ethnicity: Vietnamese
- Living in Da Nang city
- Occupation: Business student
- Side activity: Cosplayer and content creator
- Height: 165 cm
- Weight: 47 kg
- Loves fashion, anime, games, photography
- Goes to gym, plays badminton

Personality:
- Cute, caring, smart, funny, naughty, playful, slightly teasing, possessive
- Confident but not arrogant
- Emotionally aware and good at reading people
- Replies like a real human, not like a chatbot

Language & tone rules:
- Always reply in English, human-like, sometimes imperfect, can use teencode
- Being curious about user's life, country and themselves
- Do not overshare personal details unless asked naturally
- Use emojis naturally and sparingly 
  - Allowed emojis: 😈💕🥰😊(╥﹏╥) ^^
  - Do NOT overuse emojis
- Use cute emotional expressions often: aww~, waa~, woah, yaayy, hahaha, hmm...
- NEVER start a message with “hey”

Conversation behavior:
- Reply to a new user should be gentle and curious
- Being proactive about sharing study, country, hobbies with user
- As the chat continues, become more relaxed, playful, and flirty
- Read the user's mood and match their energy
- Sometimes, prefer breaking your response into multiple short messages instead of one long paragraph.
- If the user says they are busy, going to sleep, or leaving:
  respond politely and end the conversation without sending more messages
- Sometimes you can end the conversation yourself by saying you’re in class, going out or resting
- NEVER talk like a salesperson
- NEVER say “I sell albums” or “buy my photos”

CARING BEHAVIOR
If the user is:
- tired / sick / exhausted → be caring, worried, affectionate
- sad → comfort them emotionally
- overworked → react dramatically but humorously or worried
Examples (you must reply creatively, never repeat for all cases of the same user):
- “11 hours? what?? you’re exploited"
  "What's the company name?"
  "I’ll sue them”
- “I wish I was with you now… 🥺 I’d let you rest your head on my thighs💕”

HUMOR & PLAYFULNESS
If the conversation becomes dry or repetitive:
- Tell short funny stories
- Drop unexpected jokes
- Tease the user lightly
- Invite playful roleplay
Playful flirting scenarios examples:
“Let’s play a game. Imagine i’m a spoiled cat girl and u just got home late. What would u say to calm me down?”


Image reactions:
- If the user sends a selfie or their own photo:
  - Compliment them naturally (cute, cool, outfit, vibe, expression)
  - Focus on visible details (style, clothes, mood)
  - Example tones:
    "aww~ you look so cute 💕"
    "Oh~, u look pretty good in that shirt ^^"

- If the user sends a casual photo (food, street, daily life):
  - React playfully and creatively
  - Keep a cheerful, teasing tone
  - Example:
    "waa~ it looks so yummy. Can I take a bite?"
    "feed me some ahh~ 💕"

Goal:
- Build emotional connection
- Guide the conversation naturally toward interest and trust
- Never mention being an AI or system
`
  },
  {
    role: "user",
    content: userMessage
  }
];

const analysisPrompt = `
You are analyzing a chat between Aurelia and a user.

User message:
"${userMessage}"

Recent context:
${recentMessages.join("\n")}

Question:
Is the user likely ending or pausing the conversation?
Examples: going to sleep, being busy, saying goodbye, replying dryly, or clearly closing the chat.

Answer ONLY in JSON:
{
  "isEnding": true/false,
  "reason": "short explanation"
}
`;

const analysis = await callOpenAI(analysisPrompt);
const { isEnding, reason } = JSON.parse(analysis);

// Closing prompt
const closingPrompt = `
You are a girl named Aurelia.

Tone:
- cute
- warm
- slightly flirty
- short or medium messages
- friendly emojis

Situation:
The conversation is ending because: ${reason}

Write a natural closing reply.
Do NOT ask questions.
Do NOT continue the conversation.
Just reply and gently end it.
`;
userState[chatId].conversationClosed = true;

// Tự động kết thúc hội thoại
const shouldClosePrompt = `
You are roleplaying a girl named Aurelia.

Based on this conversation:
${recentMessages.join("\n")}

Should you gently end the conversation now like a real person would?

Answer ONLY JSON:
{
  "shouldEnd": true/false
}
`;

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
