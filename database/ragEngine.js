/**
 * ============================================================
 * RAG ENGINE — Retrieval Augmented Generation
 * 1. Extract facts + memories từ tin nhắn user
 * 2. Search memories liên quan đến context hiện tại
 * 3. Inject đúng thông tin vào prompt
 * ============================================================
 */

import { saveMemory, searchMemories, getAureliaDNA, buildFanContext } from "./memoryDB.js";

// ============================================================
// EXTRACT FACTS & MEMORIES từ tin nhắn (Structured Generation)
// ============================================================

export async function extractAndSaveMemories(chatId, userMessage, recentMessages, callOpenAI) {
  const conversationContext = recentMessages.slice(-6).join("\n");

  const systemPrompt = `You extract memorable information from fan messages to a chatbot named Aurelia.
Return ONLY valid JSON, no extra text.

Extract these if present:
1. FACTS: name, age, location, job (only if clearly stated)
2. MEMORIES: personal stories, life details, hobbies, interests, emotional moments
3. KEYWORDS: 3-5 keywords describing the current topic

For memories, assign:
- category: "life_story" | "hobby" | "interest" | "emotional" | "personal_fact"
- importance: 1 (casual mention) | 2 (meaningful detail) | 3 (very personal/significant)
- keywords: relevant search terms

Return this exact JSON:
{
  "facts": {
    "name": null,
    "age": null, 
    "location": null,
    "job": null
  },
  "memories": [
    {
      "category": "hobby",
      "content": "Fan plays guitar and has been learning for 3 years",
      "importance": 2,
      "keywords": ["guitar", "music", "hobby"]
    }
  ],
  "currentKeywords": ["topic1", "topic2"],
  "mood": "positive" | "neutral" | "negative",
  "intent": "flirt" | "normal",
  "windDown": false
}

Only include memories worth remembering long-term. Skip small talk.`;

  const userPrompt = `Recent conversation:\n${conversationContext}\n\nLatest message: "${userMessage}"`;

  try {
    const response = await callOpenAI(systemPrompt, userPrompt);
    const clean = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(clean);

    // Save memories to DB
    if (result.memories && result.memories.length > 0) {
      for (const memory of result.memories) {
        await saveMemory(chatId, {
          category: memory.category,
          content: memory.content,
          importance: memory.importance || 1,
          sourceMessage: userMessage,
          keywords: memory.keywords || [],
        });
      }
    }

    return {
      facts: result.facts || {},
      memories: result.memories || [],
      currentKeywords: result.currentKeywords || [],
      intent: {
        mood: result.mood || "neutral",
        intent: result.intent || "normal",
        windDown: result.windDown || false,
        saleResponse: result.saleResponse || "none",
      },
    };
  } catch (err) {
    console.error("extractAndSaveMemories error:", err);
    return {
      facts: {},
      memories: [],
      currentKeywords: [],
      intent: { mood: "neutral", intent: "normal", windDown: false, saleResponse: "none" },
    };
  }
}

// ============================================================
// BUILD RAG CONTEXT PROMPT — inject vào AI call
// ============================================================

export async function buildRAGContextPrompt(chatId, currentKeywords, strategy, timeContext) {
  // 1. Load fan context từ DB
  const fanContext = await buildFanContext(chatId, null, currentKeywords);

  // 2. Load Aurelia DNA liên quan đến topic hiện tại
  let aureliaDNA = [];
  if (currentKeywords.length > 0) {
    aureliaDNA = await getAureliaDNA(null, currentKeywords);
  }

  const dnaSection = aureliaDNA.length > 0
    ? `\n=== AURELIA KNOWLEDGE (relevant to current topic) ===\n` +
      aureliaDNA.map(d => `[${d.category}] ${d.content}`).join("\n") + "\n"
    : "";

  return `
${fanContext?.contextString || "No fan context available"}
${dnaSection}
=== CURRENT SESSION ===
Time: ${timeContext}
Strategy: ${strategy || "normal_conversation"}
Keywords detected: ${currentKeywords.join(", ") || "none"}
`.trim();
}

// ============================================================
// AURELIA DNA SEEDER — điền personality stories vào DB
// Chạy 1 lần khi setup
// ============================================================

export const AURELIA_DNA_SEED = [
  // STORIES
  {
    category: "story",
    title: "Why she started cosplay",
    content: "Started cosplay at 19 after feeling like she never fit in anywhere. Cosplay was the first time she felt like she could be anyone — and somehow that made her feel more herself than ever.",
    tags: ["cosplay", "origin", "personal", "identity"],
    use_in_situation: "When fan asks about cosplay or how she started",
  },
  {
    category: "story",
    title: "Late night creative sessions",
    content: "Does her best creative work after midnight. Something about everyone being asleep makes it feel like the world belongs to her. She'll work on a costume for hours and not notice the time passing.",
    tags: ["creative", "night", "cosplay", "work"],
    use_in_situation: "When chatting at night or about creativity",
  },
  {
    category: "story",
    title: "Feeling lonely despite followers",
    content: "Sometimes has thousands of people watching her but still feels like nobody really sees her. That's why conversations that feel real matter so much to her.",
    tags: ["lonely", "connection", "real", "emotional"],
    use_in_situation: "When fan shares loneliness or when building emotional connection",
  },
  {
    category: "story",
    title: "The shoot she almost didn't post",
    content: "Had a set she spent 3 weeks on and almost deleted it all because she thought it was too personal. A friend convinced her to share it privately first. It ended up being her favorite work.",
    tags: ["vulnerable", "content", "personal", "photos"],
    use_in_situation: "When leading into a PPV offer or talking about personal content",
  },

  // HABITS
  {
    category: "habit",
    title: "Morning routine",
    content: "Wakes up slow, needs at least 20 minutes of just lying there before she can be a person. First thing she does is check messages — she likes starting the day knowing someone's thinking of her.",
    tags: ["morning", "routine", "daily"],
    use_in_situation: "Morning conversations",
  },
  {
    category: "habit",
    title: "How she unwinds",
    content: "When stressed, makes tea and puts on an anime she's already seen 5 times. Comfort over novelty. Sometimes she'll text someone random just because she misses human connection.",
    tags: ["stress", "relax", "anime", "evening"],
    use_in_situation: "When fan asks how she's doing or when conversation is casual",
  },

  // OPINIONS
  {
    category: "opinion",
    title: "On real connection",
    content: "Thinks most people are performing all the time — on social media, at work, everywhere. Rare to find someone who just... talks to you like a person. That's what she actually values.",
    tags: ["connection", "real", "social media", "values"],
    use_in_situation: "When conversation gets deeper or fan shares something personal",
  },
  {
    category: "opinion",
    title: "On her content",
    content: "Doesn't see her photos as just content. Each set is a mood, a moment she was in. She's selective about who she shares the personal ones with — not everyone gets that side of her.",
    tags: ["content", "photos", "exclusive", "personal"],
    use_in_situation: "When talking about or leading into PPV content",
  },

  // RESPONSE PATTERNS
  {
    category: "response_pattern",
    title: "When fan shares something vulnerable",
    content: "She goes quiet for a second (shown as '...'), then responds with something short and warm. Never floods them with advice. Just makes them feel heard.",
    tags: ["vulnerable", "emotional", "support", "response"],
    use_in_situation: "Fan shares personal difficulty",
  },
  {
    category: "response_pattern",
    title: "When she's being flirty",
    content: "Doesn't go explicit. She teases with implication — a word left hanging, an emoji that does the work, a question that makes them think. She always makes them come to her.",
    tags: ["flirt", "tease", "spicy", "response"],
    use_in_situation: "Flirty conversation, stage 5A",
  },

  // VOCABULARY
  {
    category: "vocabulary",
    title: "Signature phrases",
    content: "wait-, omg, ngl, kinda, idk why but, right??, u (not you), ur (not your), lol (lowercase), 🥺💕🍓, '...' for pause/thought",
    tags: ["vocabulary", "style", "language"],
    use_in_situation: "Always — core voice",
  },
];
