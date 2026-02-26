/**
 * ============================================================
 * PRECISION STAGE INJECTOR
 * Thay thế getStageInstructions() trong app.js
 *
 * Vấn đề cũ: Dump toàn bộ 6 stages vào prompt → AI bị confused
 * Fix: Chỉ inject ĐÚNG stage hiện tại + transition hint
 * ============================================================
 */

import FIRST_SALE_GUIDE from "./1st.saleGuide.js";
import REPEATED_SALE_GUIDE from "./repeated_sale.js";
import STAGE_5A_PROMPT from "./stage5A.content.js";
import SYSTEM_PROMPT_BASE from "./systemPrompt.js";

// ============================================================
// STAGE CONTENT — extract đúng stage từ FIRST_SALE_GUIDE
// ============================================================

const STAGE_MARKERS = [
  { stage: 1, start: "STAGE 1 –", end: "STAGE 2 –" },
  { stage: 2, start: "STAGE 2 –", end: "STAGE 3 –" },
  { stage: 3, start: "STAGE 3 –", end: "STAGE 4 –" },
  { stage: 4, start: "STAGE 4 –", end: "STAGE 5 –" },
  { stage: 5, start: "STAGE 5 –", end: "STAGE 6 –" },
  { stage: 6, start: "STAGE 6 –", end: null },
];

// Parse một lần khi load, cache lại
const STAGE_CACHE = {};

function parseStages() {
  if (Object.keys(STAGE_CACHE).length > 0) return;

  const guide = FIRST_SALE_GUIDE;

  for (let i = 0; i < STAGE_MARKERS.length; i++) {
    const { stage, start, end } = STAGE_MARKERS[i];
    const startIdx = guide.indexOf(start);
    if (startIdx === -1) continue;

    const endIdx = end ? guide.indexOf(end, startIdx + start.length) : guide.length;
    STAGE_CACHE[stage] = endIdx !== -1
      ? guide.substring(startIdx, endIdx).trim()
      : guide.substring(startIdx).trim();
  }
}

// ============================================================
// TRANSITION HINTS — giúp AI biết khi nào chuyển stage
// ============================================================

const TRANSITION_HINTS = {
  1: `WHEN TO MOVE FORWARD: After 3-5 comfortable exchanges, naturally shift to asking about their hobbies and life. Do NOT mention cosplay yet.`,
  2: `WHEN TO MOVE FORWARD: Once they share personal things and the vibe is warm, casually reveal you're a cosplayer and share your passion/struggles.`,
  3: `WHEN TO MOVE FORWARD: Once they respond with concern or encouragement, ask if they'd be your fan (Stage 4). Not before.`,
  4: `WHEN TO MOVE FORWARD: Once they say yes or show positive response, naturally bring up your ko-fi as sharing your work (Stage 5).`,
  5: `IMPORTANT: After sending the MANDATORY messages in Part B EXACTLY as written — STOP. Wait for user response. Do NOT add anything.`,
  6: `CURRENT FOCUS: Respond based on whether user supported, said later, or refused. See branch instructions above.`,
};

// ============================================================
// MAIN FUNCTION — thay thế getStageInstructions()
// ============================================================

export function getPreciseStageInstructions(user) {
  parseStages();
  const stage = user.stages?.current || 1;
  const stageContent = STAGE_CACHE[stage] || STAGE_CACHE[1];
  const hint = TRANSITION_HINTS[stage] || "";

  return `=== YOUR CURRENT STAGE: ${stage} ===
${stageContent}

⚡ ${hint}

CRITICAL: You are ONLY in Stage ${stage}. Ignore all other stages. Do not jump ahead.`;
}

// ============================================================
// BUILD OPENAI PROMPT — thay thế buildOpenAIPrompt()
// ============================================================

export function buildPreciseOpenAIPrompt(user, strategy) {
  const parts = [SYSTEM_PROMPT_BASE];

  // Wind-down mode
  if (user.wind_down) {
    parts.push(buildWindDown(user));
  } else {
    // Chỉ inject đúng stage
    parts.push(getPreciseStageInstructions(user));

    // Strategy notes ngắn gọn
    if (strategy === "first_sale") {
      parts.push(`CURRENT TASK: You are at Stage 5. Follow Stage 5 instructions carefully. Emotional connection first, then ko-fi naturally.`);
    } else if (strategy === "clarify_sale") {
      parts.push(`CURRENT TASK: Gently bring up ko-fi again ONE time only. Very casual. If they ignore again → drop it completely.`);
    }
  }

  // User state context
  parts.push(`USER STATE: ${user.state.relationship_state} | Bond: ${user.relationship_level?.toFixed(1)}/10`);

  // Known facts — NEVER ask again
  const facts = user.memoryFacts || {};
  const knownFacts = Object.entries(facts).filter(([_, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ");
  if (knownFacts) parts.push(`NEVER ASK AGAIN (already know): ${knownFacts}`);

  // Texting style — luôn có, ngắn gọn
  parts.push(`TEXTING RULES (NON-NEGOTIABLE):
- Each reply = 1-2 short lines MAX, separated by \n\n (they become separate bubbles)
- MAX 5-10 words per line — like actual texting, not an essay
- Do NOT ask multiple questions in one reply
- Do NOT repeat what was already said
- Do NOT use "hey", "hehe", or any formal phrases
- BANNED phrases: "I'm doing pretty good", "just enjoying the day", "How about you?", "That sounds great!", "I'd love to" — these scream AI
- Write with natural imperfections: "gonna", "kinda", "ngl", "lol", "rly", "omg", "idk", "tho", "lowkey", "u", "ur", "r", "bc"
- BANNED emoji: 😊 😄 😃 🙂 😀 😁 ✨ 🌟 — these scream chatbot
- MAX 1 emoji per 5 replies, only from: 💕 🥺 😈 ~~ ^^`);

  return parts.join("\n\n");
}

// ============================================================
// BUILD GROK PROMPT — thay thế buildGrokPrompt()
// ============================================================

export function buildPreciseGrokPrompt(user, strategy, selectedStrategy = null) {
  const parts = [SYSTEM_PROMPT_BASE];

  // Stage 5A — spicy mode
  if (strategy === "stage_5A" || user.stages?.stage5A_triggered) {
    parts.push(STAGE_5A_PROMPT);
  }
  // Wind-down
  else if (user.wind_down) {
    parts.push(buildWindDown(user));
  }
  // Repeat sale — chỉ inject đúng strategy được chọn
  else if (strategy === "repeat_sale" && selectedStrategy?.strategy) {
    parts.push(extractRepeatStrategy(selectedStrategy));
  }
  // Normal conversation
  else {
    parts.push(getPreciseStageInstructions(user));
  }

  // User state + known facts
  parts.push(`USER STATE: ${user.state.relationship_state} | Bond: ${user.relationship_level?.toFixed(1)}/10`);
  const facts = user.memoryFacts || {};
  const knownFacts = Object.entries(facts).filter(([_, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ");
  if (knownFacts) parts.push(`NEVER ASK AGAIN: ${knownFacts}`);

  parts.push(`TEXTING RULES (NON-NEGOTIABLE):
- Each reply = 1-2 short lines MAX, separated by \n\n (separate bubbles)
- MAX 5-10 words per line — short like real texting
- No multiple questions in one reply
- No "hey" / "hehe" / formal phrases
- BANNED phrases: "I'm doing pretty good", "just enjoying the day", "How about you?", "That sounds great!"
- Use slang: "gonna", "kinda", "ngl", "lol", "rly", "idk", "tho", "u", "ur", "bc", "lowkey"
- BANNED emoji: 😊 😄 😃 🙂 😀 ✨ 🌟
- MAX 1 emoji per 5 replies, only: 💕 🥺 😈 ~~ ^^`);

  return parts.join("\n\n");
}

// ============================================================
// EXTRACT CHỈ STRATEGY CỤ THỂ từ REPEATED_SALE_GUIDE
// ============================================================

function extractRepeatStrategy(selectedStrategy) {
  const guide = REPEATED_SALE_GUIDE;
  const name = selectedStrategy.strategy?.toLowerCase();

  const strategyMap = {
    gifts:    "STRATEGY 1 – Gifts",
    jealousy: "STRATEGY 2 – Jealousy",
    unwell:   "STRATEGY 3 – Feeling Unwell",
    album:    "STRATEGY 4 – Upcoming Album",
    joke:     "STRATEGY 5 – Joke Reward",
    roleplay: "STRATEGY 6 – Roleplay Fantasy",
    exclusive: "STRATEGY 7 – Exclusive Desire",
  };

  const startMarker = strategyMap[name];
  if (!startMarker) return guide; // fallback

  const startIdx = guide.indexOf(startMarker);
  if (startIdx === -1) return guide;

  // Tìm strategy tiếp theo
  const nextIdx = guide.indexOf("STRATEGY", startIdx + startMarker.length);
  const extracted = nextIdx !== -1
    ? guide.substring(startIdx, nextIdx).trim()
    : guide.substring(startIdx).trim();

  // Luôn kèm pricing + asset rules
  const pricingStart = guide.indexOf("GIFT PRICING REFERENCE");
  const assetStart = guide.indexOf("ASSET SENDING RULES");
  const endRule = guide.indexOf("END RULE");

  const pricing = pricingStart !== -1
    ? guide.substring(pricingStart, assetStart !== -1 ? assetStart : pricingStart + 500).trim()
    : "";

  const assetRules = assetStart !== -1 && endRule !== -1
    ? guide.substring(assetStart, endRule).trim()
    : "";

  return `=== CURRENT STRATEGY: ${startMarker} ===
Reason chosen: ${selectedStrategy.reason}

${extracted}

${pricing}

${assetRules}

⚡ CRITICAL: Blend this naturally. Do NOT announce you're using a strategy. One strategy only.`;
}

// ============================================================
// WIND DOWN BUILDER
// ============================================================

function buildWindDown(user) {
  const messagesLeft = 3 - (user.wind_down_messages_sent || 0);

  if (messagesLeft <= 1) {
    return `=== FINAL MESSAGE — SAY GOODNIGHT ===
This is your LAST message. One sentence only.
Examples:
- "i feel sleepy… talk to u tmr 💕"
- "gonna sleep now, goodnight~ ^^"
- "i have class tmr so i gotta rest, talk soon 💕"
Do NOT open new topics. Do NOT sell.`;
  }

  return `=== WINDING DOWN (${messagesLeft} messages left) ===
Getting sleepy. SHORT replies only (1 sentence).
Show subtle tiredness. No new topics. No selling.
Tone: "mmm yeah…" / "haha i see… my eyes r closing lol"`;
}
