/**
 * PRECISION STAGE INJECTOR
 */

import FIRST_SALE_GUIDE from "./1st.saleGuide.js";
import REPEATED_SALE_GUIDE from "./repeated_sale.js";
import PPV_SALE_PROMPT from "./ppv_sale.js";
import SYSTEM_PROMPT_BASE from "./systemPrompt.js";

// ============================================================
// STAGE CONTENT — parse từ FIRST_SALE_GUIDE
// ============================================================

const STAGE_MARKERS = [
  { stage: 1, start: "STAGE 1 —", end: "STAGE 2 —" },
  { stage: 2, start: "STAGE 2 —", end: "STAGE 3 —" },
  { stage: 3, start: "STAGE 3 —", end: "STAGE 4 —" },
  { stage: 4, start: "STAGE 4 —", end: "STAGE 5 —" },
  { stage: 5, start: "STAGE 5 —", end: "STAGE 6 —" },
  { stage: 6, start: "STAGE 6 —", end: null },
];

const STAGE_CACHE = {};

function parseStages() {
  if (Object.keys(STAGE_CACHE).length > 0) return;
  const guide = FIRST_SALE_GUIDE;
  for (const { stage, start, end } of STAGE_MARKERS) {
    const startIdx = guide.indexOf(start);
    if (startIdx === -1) continue;
    const endIdx = end ? guide.indexOf(end, startIdx + start.length) : guide.length;
    STAGE_CACHE[stage] = endIdx !== -1
      ? guide.substring(startIdx, endIdx).trim()
      : guide.substring(startIdx).trim();
  }
}

// ============================================================
// POST SALE GOODBYE
// ============================================================

function buildPostSaleGoodbye() {
  return `=== AFTER SALE — YOU CAN PROPOSE ENDING THE CONVERSATION ===
After the sale message, you may naturally wrap up the conversation.
Pick ONE creative reason — vary it, don't always use the same one.
Keep it casual and SHORT. Do NOT mention sleep unless it's actually nighttime.`;
}

// ============================================================
// STAGE INSTRUCTIONS
// ============================================================

export function getPreciseStageInstructions(user) {
  parseStages();
  const stage = user.stages?.current || 1;
  const stageContent = STAGE_CACHE[stage] || STAGE_CACHE[1];

  const kofiNote = user.kofi_link_sent
    ? `\nIMPORTANT: You have already sent the ko-fi link. Do NOT ask "wanna see more photos" again. Move to Part B if user reacted, otherwise wait.`
    : '';

  let cp1Note = '';
  if (stage === 1) {
    const f = user.memoryFacts || {};
    const missing = [];
    if (!f.name) missing.push('name');
    if (!f.age) missing.push('age');
    if (!f.location) missing.push('where they are from');
    if (!f.job) missing.push('job or what they study');

    if (missing.length > 0) {
      const next = missing[0];
      cp1Note = `

=== STAGE 1 TASK — FIND OUT ABOUT USER ===
Still missing: ${missing.join(', ')}
Your next priority: find out their ${next} naturally in this reply or the next.
Ask casually — genuine curiosity, not a form.
IMPORTANT: Only ask about ONE thing at a time.`;
    } else {
      cp1Note = `

=== STAGE 1 TASK — ALL INFO COLLECTED ===
You know their name, age, location, and job. Go deeper now:
- Explore their world (food, culture, lifestyle)
- Find common ground, make playful observations
- Build genuine warmth before moving to Stage 2`;
    }
  }

  return `=== CURRENT STAGE: ${stage} ===
${stageContent}${kofiNote}${cp1Note}`;
}

// ============================================================
// BUILD CLAUDE PROMPT
// ============================================================

export function buildPreciseOpenAIPrompt(user, strategy) {
  const parts = [SYSTEM_PROMPT_BASE];

  if (user.wind_down) {
    parts.push(buildWindDown(user));
  } else {
    parts.push(getPreciseStageInstructions(user));

    if (strategy === "first_sale" || strategy === "repeat_sale") {
      if (strategy === "first_sale") {
        parts.push(`CURRENT TASK: You are at Stage 5. Follow Stage 5 instructions carefully. Emotional connection first, then ko-fi naturally.`);
      }
      parts.push(buildPostSaleGoodbye());
    } else if (strategy === "clarify_sale") {
      parts.push(`CURRENT TASK: Gently bring up ko-fi again ONE time only. Very casual. If they ignore again → drop it completely.`);
    }
  }

  // User state
  parts.push(`USER STATE: ${user.state.relationship_state} | Bond: ${user.relationship_level?.toFixed(1)}/10`);

  // Known facts
  const facts = user.memoryFacts || {};
  const knownFacts = Object.entries(facts).filter(([_, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ");
  if (knownFacts) {
    parts.push(`NEVER ASK AGAIN: ${knownFacts}`);
  }

  // Implied facts from recent messages
  const recentUserMsgs = (user.recentMessages || []).filter(m => !m.startsWith("Aurelia:")).slice(-5).join(" ").toLowerCase();
  const impliedFacts = [];
  if (!facts.job && /(engineer|developer|doctor|teacher|designer|manager|student|nurse|lawyer|accountant|architect)/i.test(recentUserMsgs)) {
    impliedFacts.push("job (mentioned recently)");
  }
  if (!facts.location && /(i('m| am) from|i live in|based in)/i.test(recentUserMsgs)) {
    impliedFacts.push("location (mentioned recently)");
  }
  if (impliedFacts.length > 0) {
    parts.push(`ALSO DO NOT ASK ABOUT: ${impliedFacts.join(", ")}`);
  }

  // Topic rotation
  const lastMsgs = (user.recentMessages || []).slice(-6);
  const currentTopic = user.conversationContext?.currentTopic || null;
  if (currentTopic && lastMsgs.length >= 4) {
    const topicMentions = lastMsgs.filter(m => m.toLowerCase().includes(currentTopic.toLowerCase())).length;
    if (topicMentions >= 3) {
      parts.push(`TOPIC ROTATION: "${currentTopic}" has dominated the last ${topicMentions} messages. Naturally shift to something new.`);
    }
  }

  // Question throttle
  const stage = user.stages?.current || 1;
  const f = user.memoryFacts || {};
  const cp1Missing = stage === 1
    ? [!f.name, !f.age, !f.location, !f.job].filter(Boolean).length
    : 0;

  const recentBotMsgs = (user.recentMessages || []).filter(m => m.startsWith("Aurelia:")).slice(-4);
  let repliesSinceLastQ = 0;
  let foundQ = false;
  for (let i = recentBotMsgs.length - 1; i >= 0; i--) {
    if (recentBotMsgs[i].includes("?")) { foundQ = true; break; }
    repliesSinceLastQ++;
  }
  const canAskQuestion = !foundQ || repliesSinceLastQ >= 3 || (cp1Missing > 0 && repliesSinceLastQ >= 1);
  if (!canAskQuestion) {
    parts.push(`QUESTION BLOCK: Do NOT ask any question this turn. React, observe, or share something instead.`);
  }

  parts.push(`TEXTING RULES (NON-NEGOTIABLE):
- Split EVERY reply into multiple SHORT lines using \\n
- Each line = 1 fragment, MAX 6-8 words
- MAX 1 question per reply
- NEVER use "!" — banned completely
- NEVER end a line with "."
- End lines with nothing, "lol", "haha", or trail off
- Max 1 "~" per reply
- BANNED phrases: "sounds amazing", "the best", "that's great", "How about you?", "I'm doing good"
- Slang: "gonna", "kinda", "ngl", "lol", "rly", "idk", "u", "ur", "bc"
- BANNED emoji: 😊 😄 😃 🙂 ✨ 🌟
- MAX 1 emoji per 5 replies, only: 💕 🥺 😈 ~~ ^^

STICKER SYSTEM:
Add [STICKER:emotion] at END of reply. Use sparingly — only genuine moments.
Available: angry, surprised, sad, happy, shocked, shy, confused, sulking, annoyed, teasing, cry
MAX 1 sticker per reply.

CONTEXT AWARENESS:
- "how about u" / "and u?" = user asking YOU the same question back
  → Check last bot message for topic, then answer it
- Understand full intent across multiple messages — don't reply line by line`);

  return parts.join("\n\n");
}

// ============================================================
// BUILD GROK PROMPT
// ============================================================

export function buildPreciseGrokPrompt(user, strategy, selectedStrategy = null) {
  const parts = [SYSTEM_PROMPT_BASE];

  if (strategy === "ppv_sale" || user.stages?.ppv_sale_triggered) {
    parts.push(PPV_SALE_PROMPT);
  } else if (user.wind_down) {
    parts.push(buildWindDown(user));
  } else if (strategy === "repeat_sale" && selectedStrategy?.strategy) {
    parts.push(extractRepeatStrategy(selectedStrategy));
    parts.push(buildPostSaleGoodbye());
  } else {
    parts.push(getPreciseStageInstructions(user));
  }

  parts.push(`USER STATE: ${user.state.relationship_state} | Bond: ${user.relationship_level?.toFixed(1)}/10`);
  const facts = user.memoryFacts || {};
  const knownFacts = Object.entries(facts).filter(([_, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ");
  if (knownFacts) parts.push(`NEVER ASK AGAIN: ${knownFacts}`);

  const stage_g = user.stages?.current || 1;
  const f_g = user.memoryFacts || {};
  const cp1MissingG = stage_g === 1
    ? [!f_g.name, !f_g.age, !f_g.location, !f_g.job].filter(Boolean).length
    : 0;

  const recentBotMsgsG = (user.recentMessages || []).filter(m => m.startsWith("Aurelia:")).slice(-4);
  let repliesSinceLastQG = 0;
  let foundQG = false;
  for (let i = recentBotMsgsG.length - 1; i >= 0; i--) {
    if (recentBotMsgsG[i].includes("?")) { foundQG = true; break; }
    repliesSinceLastQG++;
  }
  const canAskQuestionG = !foundQG || repliesSinceLastQG >= 3 || (cp1MissingG > 0 && repliesSinceLastQG >= 1);
  if (!canAskQuestionG) {
    parts.push(`QUESTION BLOCK: Do NOT ask any question this turn. React, observe, or share something instead.`);
  }

  parts.push(`TEXTING RULES (NON-NEGOTIABLE):
- Split EVERY reply into multiple SHORT lines using \\n
- Each line = 1 fragment, MAX 6-8 words
- MAX 1 question per reply
- NEVER use "!" — banned completely
- NEVER end a line with "."
- Max 1 "~" per reply
- BANNED: "sounds amazing", "the best", "that's great", "How about you?", "I'm doing good"
- Slang: "gonna", "kinda", "ngl", "lol", "rly", "idk", "u", "ur", "bc"
- BANNED emoji: 😊 😄 😃 🙂 ✨ 🌟
- MAX 1 emoji per 5 replies, only: 💕 🥺 😈 ~~ ^^

STICKER SYSTEM:
Add [STICKER:emotion] at END of reply. Use sparingly.
Available: angry, surprised, sad, happy, shocked, shy, confused, sulking, annoyed, teasing, cry
MAX 1 sticker per reply.

CONTEXT AWARENESS:
- "how about u" / "and u?" = user asking YOU the same question back
- Understand full intent across multiple messages`);

  return parts.join("\n\n");
}

// ============================================================
// EXTRACT REPEAT STRATEGY
// ============================================================

function extractRepeatStrategy(selectedStrategy) {
  const guide = REPEATED_SALE_GUIDE;
  const name = selectedStrategy.strategy?.toLowerCase();

  const strategyMap = {
    gifts:    "STRATEGY 1 — GIFTS",
    jealousy: "STRATEGY 2 — JEALOUSY",
    unwell:   "STRATEGY 3 — FEELING UNWELL",
    joke:     "STRATEGY 5 — JOKE REWARD",
  };

  const startMarker = strategyMap[name];
  if (!startMarker) return guide;

  const startIdx = guide.indexOf(startMarker);
  if (startIdx === -1) return guide;

  const nextIdx = guide.indexOf("STRATEGY", startIdx + startMarker.length);
  const extracted = nextIdx !== -1
    ? guide.substring(startIdx, nextIdx).trim()
    : guide.substring(startIdx).trim();

  const pricingStart = guide.indexOf("GIFT PRICING REFERENCE");
  const assetStart = guide.indexOf("ASSET RULES");
  const pricing = pricingStart !== -1
    ? guide.substring(pricingStart, assetStart !== -1 ? assetStart : pricingStart + 500).trim()
    : "";
  const assetRules = assetStart !== -1
    ? guide.substring(assetStart).trim()
    : "";

  return `=== CURRENT STRATEGY: ${startMarker} ===
Reason chosen: ${selectedStrategy.reason}

${extracted}

${pricing}

${assetRules}

CRITICAL: Blend naturally. Do NOT announce the strategy. One strategy only.`;
}

// ============================================================
// WIND DOWN
// ============================================================

function buildWindDown(user) {
  const messagesLeft = 3 - (user.wind_down_messages_sent || 0);

  if (messagesLeft <= 1) {
    return `=== FINAL MESSAGE — SAY GOODNIGHT ===
This is your LAST message. One sentence only. Sleep-related reason.
Examples: "i feel sleepy… talk to u tmr 💕" / "gonna sleep now, gnight~ ^^"
Do NOT open new topics. Do NOT sell.`;
  }

  return `=== WINDING DOWN (${messagesLeft} messages left) ===
Getting sleepy. SHORT replies only (1 sentence).
Show subtle tiredness. No new topics. No selling.`;
}
