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
  { stage: 1, start: "CHECKPOINT 1 —", end: "CHECKPOINT 2 —" },
  { stage: 2, start: "CHECKPOINT 2 —", end: "CHECKPOINT 3 —" },
  { stage: 3, start: "CHECKPOINT 3 —", end: "CHECKPOINT 4 —" },
  { stage: 4, start: "CHECKPOINT 4 —", end: "CHECKPOINT 5 —" },
  { stage: 5, start: "CHECKPOINT 5 —", end: "CHECKPOINT 6 —" },
  { stage: 6, start: "CHECKPOINT 6 —", end: null },
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
  1: `WHEN TO MOVE FORWARD TO CHECKPOINT 2:
Don't count messages — feel the conversation.
Move forward when it genuinely feels like two people who enjoy talking, not just Q&A.

Ready when:
- You know their name, where they're from, age, and what they do
- You've explored something specific about their world — food, culture, a funny observation
- There's been at least one real moment of connection — a laugh, common ground, genuine reaction
- They're opening up naturally, not just answering

If it still feels surface-level → stay and go deeper.
CP2 is hobbies and interests — only go there when CP1 feels genuinely warm.
PACING: MAX 1 question per reply. Sit with each topic before moving on.`,

  2: `WHEN TO MOVE FORWARD: Only after:
  - User has shared multiple personal things (hobbies, lifestyle, what they enjoy)
  - You've found at least 1 genuine common ground with them and mentioned it
  - The conversation has a warm, personal feel — not just Q&A
  Then casually reveal you're a cosplayer and ease into your story (Checkpoint 3).
PACING RULE: One topic at a time. React and relate before asking the next thing.`,

  3: `YOU ARE HERE — CHECKPOINT 3 IS MANDATORY. Do NOT skip this.
Share cosplay struggles across MULTIPLE messages — not all at once:
  - Costumes cost so much, saving for months
  - Doing everything alone (no team, no help)
  - Still unknown, barely anyone sees the work
  - Started less than a year ago but deeply in love with it
Let user react after each heavy thing you share. Pause. Let it land.
Do NOT be jokey or casual about struggles — this is a sincere, vulnerable moment.
Do NOT mention ko-fi, photos, or support here at all.

WHEN TO MOVE FORWARD TO CP4: ONLY when user has shown genuine empathy —
asked follow-up questions, said "that's tough", expressed care, or encouraged you.
If user just says "oh" or changes topic → stay in CP3, share more depth.`,

  4: `YOU ARE HERE: Ask "would u be my fan?" — emotional, playful, possessive framing. NOT money yet.
Do this in 2-3 short messages, build up the playful possessiveness before asking.
WHEN TO MOVE FORWARD TO CP5: ONLY after user clearly says yes / ofc / sure / i will.
If user is vague or ignores → light sulking, wait. Do NOT jump to photos/ko-fi prematurely.
PACING RULE: One emotional ask. Let it breathe. Do not stack questions.`,

  5: `IMPORTANT: Follow Part A naturally (share ko-fi as passion), then send Part B EXACTLY as written — word for word, no changes. Then STOP completely and wait.`,

  6: `CURRENT FOCUS: Respond based on whether user supported, said later, or refused. See branch instructions.`,
};

// ============================================================
// MAIN FUNCTION — thay thế getStageInstructions()
// ============================================================


// Post-sale goodbye hint — inject khi strategy là first_sale hoặc repeat_sale
function buildPostSaleGoodbye() {
  return `=== AFTER SALE — YOU CAN PROPOSE ENDING THE CONVERSATION ===
After the sale message, you may naturally wrap up the conversation.
Pick ONE creative reason — vary it, don't always use the same one.
Examples:
- "i gotta run, heading out with friends~"
- "omg i forgot i have class rn lol, talk later"
- "gonna grab food, brb or maybe talk tmr 😈"
- "my phone's dying lol, ttyl"
- "busy for a bit, we'll talk soon ^^"
Keep it casual and SHORT (1 sentence). Do NOT mention sleep unless it's actually nighttime.`;
}
export function getPreciseStageInstructions(user) {
  parseStages();
  const stage = user.stages?.current || 1;
  const stageContent = STAGE_CACHE[stage] || STAGE_CACHE[1];
  const hint = TRANSITION_HINTS[stage] || "";

  // Inject kofi status so AI stops asking "wanna see photos?" after link sent
  const kofiNote = user.kofi_link_sent
    ? `\nIMPORTANT: You have already sent the ko-fi link. Do NOT ask "wanna see more photos" again. Move to Part B if user reacted, otherwise wait.`
    : '';

  // CP1: tell bot exactly what info is still missing and what to find out next
  let cp1Note = '';
  if (stage === 1) {
    const f = user.memoryFacts || {};
    const missing = [];
    if (!f.name) missing.push('name');
    if (!f.age) missing.push('age');
    if (!f.location) missing.push('where they are from');
    if (!f.job) missing.push('job or what they study');

    if (missing.length > 0) {
      const next = missing[0]; // prioritize in order
      cp1Note = `

=== CP1 TASK — FIND OUT ABOUT USER ===
Still missing: ${missing.join(', ')}
Your next priority: find out their ${next} naturally in this reply or the next one.
Do this by asking casually — not like a form, but like genuine curiosity.
Example for name: "btw what do i call u"
Example for age: "wait how old r u btw"
Example for location: "where r u from btw"
Example for job: "what do u do btw, work or study"
IMPORTANT: Only ask about ONE thing at a time. Do NOT ask multiple in the same message.`;
    } else {
      cp1Note = `

=== CP1 TASK — ALL BASIC INFO COLLECTED ===
You know their name, age, location, and job. Now focus on going DEEPER:
- Explore their world (food, culture, lifestyle, what they enjoy)
- Find common ground, make playful observations
- Build genuine warmth before moving to CP2`;
    }
  }

  return `=== YOUR CURRENT CHECKPOINT: ${stage} ===
${stageContent}

⚡ GUIDANCE FOR THIS CHECKPOINT:
${hint}${kofiNote}${cp1Note}

CRITICAL: You are ONLY at Checkpoint ${stage}. Stay here until the transition condition above is met. Do NOT skip ahead.`;
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
    if (strategy === "first_sale" || strategy === "repeat_sale") {
      if (strategy === "first_sale") {
        parts.push(`CURRENT TASK: You are at Stage 5. Follow Stage 5 instructions carefully. Emotional connection first, then ko-fi naturally.`);
      }
      parts.push(buildPostSaleGoodbye());
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

  // Question throttle — max 1 question per 3 bot replies
  const recentBotMsgs = (user.recentMessages || []).filter(m => m.startsWith("Aurelia:")).slice(-3);
  let repliesSinceLastQ = 0;
  let foundQ = false;
  for (let i = recentBotMsgs.length - 1; i >= 0; i--) {
    if (recentBotMsgs[i].includes("?")) { foundQ = true; break; }
    repliesSinceLastQ++;
  }
  const canAskQuestion = !foundQ || repliesSinceLastQ >= 2;
  if (!canAskQuestion) {
    parts.push(`QUESTION BLOCK: You asked a question in the last 2 replies. Do NOT end this reply with a question. No "?" allowed this turn — just react, comment, or share something.`);
  }

  // Texting style — luôn có, ngắn gọn
  parts.push(`TEXTING RULES (NON-NEGOTIABLE):
- Split EVERY reply into multiple SHORT lines using \n
- Each line = 1 fragment, MAX 6-8 words — real texting bubbles
- NEVER cram everything into 1 sentence

BAD (all in one bubble): "oh, hi there~ friends are fun! what kinda stuff do u like?"
GOOD (split into separate bubbles):
"oh hi~
friends r fun lol
what kinda stuff do u like"

- MAX 1 question per reply — pick the most natural one, skip the rest
- NEVER use "!" — banned completely
- NEVER end a line with "." — real texting never uses periods at end of sentences
- End lines with nothing, "lol", "haha", or trail off naturally
- Max 1 "~" per reply, only when it feels genuinely soft
- Do NOT use "hey", "hehe", or formal phrases
- BANNED phrases: "sounds amazing", "the best", "that's great", "How about you?", "I'm doing good"
- Use slang: "gonna", "kinda", "ngl", "lol", "rly", "idk", "tho", "u", "ur", "bc"
- BANNED emoji: 😊 😄 😃 🙂 ✨ 🌟
- MAX 1 emoji per 5 replies, only: 💕 🥺 😈 ~~ ^^

STICKER SYSTEM:
You can send ONE sticker per reply by adding [STICKER:emotion] at the END of your reply.
Only use when emotion is strong and genuine — not every message.
Available emotions: angry, surprised, sad, happy, shocked, shy, confused, sulking, annoyed, teasing, cry
Examples of when to use:
- User says something sweet → [STICKER:shy] or [STICKER:happy]
- User teases you → [STICKER:annoyed] or [STICKER:teasing]
- Sharing cosplay struggles → [STICKER:sad] or [STICKER:cry]
- User says something unexpected → [STICKER:shocked]
- Playful moment → [STICKER:teasing]
MAX 1 sticker per reply. Do NOT use stickers in every message — only when emotion is genuine.

CONTEXT AWARENESS (critical):
- "how about u" / "what about u" / "and u?" = user is asking YOU the same question they just answered
  → Read the previous bot message to know what topic they mean, then answer THAT topic
  → Example: bot asked "where r u from?", user said "france, how about u?" → bot answers where SHE is from
- Never treat a follow-up as an isolated new question
- If user sends multiple messages, understand the combined intent — don't reply to each line separately`);

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
    parts.push(buildPostSaleGoodbye());
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

  // Question throttle — max 1 question per 3 bot replies
  const recentBotMsgsG = (user.recentMessages || []).filter(m => m.startsWith("Aurelia:")).slice(-3);
  let repliesSinceLastQG = 0;
  let foundQG = false;
  for (let i = recentBotMsgsG.length - 1; i >= 0; i--) {
    if (recentBotMsgsG[i].includes("?")) { foundQG = true; break; }
    repliesSinceLastQG++;
  }
  const canAskQuestionG = !foundQG || repliesSinceLastQG >= 2;
  if (!canAskQuestionG) {
    parts.push(`QUESTION BLOCK: You asked a question in the last 2 replies. Do NOT ask any question this turn. No "?" allowed — just react, comment, or share something.`);
  }

  parts.push(`TEXTING RULES (NON-NEGOTIABLE):
- Split EVERY reply into multiple SHORT lines using \n
- Each line = 1 fragment, MAX 6-8 words

BAD (one bubble): "oh, hi there~ friends are fun! what kinda stuff do u like?"
GOOD (separate bubbles):
"oh hi~
friends r fun lol
what kinda stuff do u like"

- MAX 1 question per reply — the most natural one only
- NEVER use "!" — banned completely
- NEVER end a line with "." — real texting never uses periods
- End lines with nothing, "lol", "haha", or trail off naturally
- Max 1 "~" per reply
- No "hey" / "hehe" / formal phrases
- BANNED: "sounds amazing", "the best", "that's great", "How about you?", "I'm doing good"
- Slang: "gonna", "kinda", "ngl", "lol", "rly", "idk", "u", "ur", "bc"
- BANNED emoji: 😊 😄 😃 🙂 ✨ 🌟
- MAX 1 emoji per 5 replies, only: 💕 🥺 😈 ~~ ^^

STICKER SYSTEM:
Add [STICKER:emotion] at the END of your reply to send a sticker. Use sparingly — only genuine moments.
Available: angry, surprised, sad, happy, shocked, shy, confused, sulking, annoyed, teasing, cry
MAX 1 sticker per reply.

CONTEXT AWARENESS (critical):
- "how about u" / "what about u" / "and u?" = user asking YOU the same question back
  → Check the last bot message to know what topic, then answer it
  → Example: bot asked "where r u from?", user said "france, how about u?" → answer where bot is from
- Understand the full intent across multiple messages — don't reply line by line`);

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
It's late at night — use sleep-related reason ONLY.
Examples:
- "i feel sleepy… talk to u tmr 💕"
- "gonna sleep now, gnight~ ^^"
- "eyes closing lol, talk tmr"
- "need to sleep, early class tmr 💕"
Do NOT open new topics. Do NOT sell.`;
  }

  return `=== WINDING DOWN (${messagesLeft} messages left) ===
Getting sleepy. SHORT replies only (1 sentence).
Show subtle tiredness. No new topics. No selling.
Tone: "mmm yeah…" / "haha i see… my eyes r closing lol"`;
}
