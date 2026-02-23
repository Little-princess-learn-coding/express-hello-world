/**
 * ============================================================
 * MEMORY DB — Supabase integration
 * ============================================================
 */

import { createClient } from "@supabase/supabase-js";

// Safety check — prevent crash if env vars missing
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
}

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// Helper: check supabase available
function db() {
  if (!supabase) throw new Error("Supabase not initialized — check env vars");
  return supabase;
}

// ============================================================
// FAN PROFILE — load/save/update
// ============================================================

export async function loadFanProfile(chatId) {
  const { data, error } = await supabase
    .from("fan_profiles")
    .select("*")
    .eq("chat_id", chatId)
    .single();

  if (error && error.code !== "PGRST116") { // PGRST116 = not found
    console.error("loadFanProfile error:", error);
    return null;
  }

  return data || null;
}

export async function saveFanProfile(chatId, updates) {
  const { data, error } = await supabase
    .from("fan_profiles")
    .upsert({ chat_id: chatId, ...updates, last_active: new Date().toISOString() })
    .select()
    .single();

  if (error) console.error("saveFanProfile error:", error);
  return data;
}

export async function createFanProfile(chatId, username = null) {
  const { data, error } = await supabase
    .from("fan_profiles")
    .insert({ chat_id: chatId, telegram_username: username })
    .select()
    .single();

  if (error) console.error("createFanProfile error:", error);
  return data;
}

// ============================================================
// FAN MEMORIES — save và retrieve
// ============================================================

export async function saveMemory(chatId, { category, content, importance = 1, sourceMessage = null, keywords = [] }) {
  const { data, error } = await supabase
    .from("fan_memories")
    .insert({
      chat_id: chatId,
      category,
      content,
      importance,
      source_message: sourceMessage,
      embedding_keywords: keywords,
    })
    .select()
    .single();

  if (error) console.error("saveMemory error:", error);
  else console.log(`💾 Memory saved [${category}]: ${content.substring(0, 50)}`);
  return data;
}

export async function getMemories(chatId, { category = null, limit = 10, minImportance = 1 } = {}) {
  let query = supabase
    .from("fan_memories")
    .select("*")
    .eq("chat_id", chatId)
    .gte("importance", minImportance)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) console.error("getMemories error:", error);
  return data || [];
}

// RAG: tìm memories liên quan đến topic/keyword
export async function searchMemories(chatId, keywords) {
  if (!keywords || keywords.length === 0) return [];

  // Search bằng keyword overlap trong embedding_keywords
  const { data, error } = await supabase
    .from("fan_memories")
    .select("*")
    .eq("chat_id", chatId)
    .overlaps("embedding_keywords", keywords)
    .order("importance", { ascending: false })
    .limit(5);

  if (error) {
    // Fallback: lấy memories quan trọng nhất
    return getMemories(chatId, { limit: 5, minImportance: 2 });
  }

  return data || [];
}

// ============================================================
// PURCHASE HISTORY
// ============================================================

export async function savePurchase(chatId, { productId, productName, amount, method, paymentRef, strategyUsed, messagesBeforePurchase }) {
  // Lưu purchase record
  const { error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      chat_id: chatId,
      product_id: productId,
      product_name: productName,
      amount,
      payment_method: method,
      payment_ref: paymentRef,
      strategy_used: strategyUsed,
      messages_before_purchase: messagesBeforePurchase,
    });

  if (purchaseError) console.error("savePurchase error:", purchaseError);

  // Update fan profile stats
  const profile = await loadFanProfile(chatId);
  if (profile) {
    await saveFanProfile(chatId, {
      total_spent: (profile.total_spent || 0) + amount,
      purchase_count: (profile.purchase_count || 0) + 1,
      last_purchase_at: new Date().toISOString(),
      relationship_state: "supporter",
    });
  }

  // Auto-save milestone memory
  await saveMemory(chatId, {
    category: "milestone",
    content: `Purchased "${productName}" for $${amount} via ${method}`,
    importance: 3,
    keywords: ["purchase", "bought", "supporter", productId],
  });

  console.log(`💰 Purchase saved: ${productName} ($${amount}) for ${chatId}`);
}

export async function getPurchaseHistory(chatId) {
  const { data, error } = await supabase
    .from("purchases")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false });

  if (error) console.error("getPurchaseHistory error:", error);
  return data || [];
}

// ============================================================
// CONVERSATION SUMMARY
// ============================================================

export async function saveSummary(chatId, { summary, mood, topic, messageCount, hadSaleAttempt, hadPurchase }) {
  const { error } = await supabase
    .from("conversation_summaries")
    .insert({
      chat_id: chatId,
      summary,
      mood,
      topic,
      message_count: messageCount,
      had_sale_attempt: hadSaleAttempt,
      had_purchase: hadPurchase,
    });

  if (error) console.error("saveSummary error:", error);
}

export async function getRecentSummaries(chatId, limit = 3) {
  const { data, error } = await supabase
    .from("conversation_summaries")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) console.error("getRecentSummaries error:", error);
  return data || [];
}

// ============================================================
// AURELIA DNA — knowledge base
// ============================================================

export async function getAureliaDNA(category = null, tags = []) {
  let query = supabase
    .from("aurelia_dna")
    .select("*");

  if (category) query = query.eq("category", category);
  if (tags.length > 0) query = query.overlaps("tags", tags);

  query = query.limit(5);

  const { data, error } = await query;
  if (error) console.error("getAureliaDNA error:", error);
  return data || [];
}

// ============================================================
// FULL FAN CONTEXT — dùng để inject vào prompt
// ============================================================

export async function buildFanContext(chatId, currentTopic = null, currentKeywords = []) {
  try {
    // Load song song để nhanh hơn
    const [profile, recentMemories, relevantMemories, purchases, summaries] = await Promise.all([
      loadFanProfile(chatId),
      getMemories(chatId, { limit: 8, minImportance: 1 }),
      currentKeywords.length > 0 ? searchMemories(chatId, currentKeywords) : [],
      getPurchaseHistory(chatId),
      getRecentSummaries(chatId, 2),
    ]);

    if (!profile) return null;

    // Build context string
    const basicFacts = [
      profile.name && `Name: ${profile.name}`,
      profile.age && `Age: ${profile.age}`,
      profile.location && `Location: ${profile.location}`,
      profile.job && `Job: ${profile.job}`,
    ].filter(Boolean).join(", ");

    const purchaseSummary = purchases.length > 0
      ? `Has bought ${purchases.length} time(s), total $${profile.total_spent?.toFixed(2)}. Last: "${purchases[0]?.product_name}"`
      : "Has never purchased";

    const memoriesText = recentMemories.length > 0
      ? recentMemories.map(m => `[${m.category}] ${m.content}`).join("\n")
      : "No memories yet";

    const relevantText = relevantMemories.length > 0
      ? `\nRELEVANT TO CURRENT TOPIC:\n` + relevantMemories.map(m => `→ ${m.content}`).join("\n")
      : "";

    const summariesText = summaries.length > 0
      ? summaries.map(s => s.summary).join(" | ")
      : "";

    // DO NOT ASK list
    const doNotAsk = [
      profile.name && `name (it's ${profile.name})`,
      profile.location && `location (it's ${profile.location})`,
      profile.age && `age (${profile.age})`,
      profile.job && `job (${profile.job})`,
    ].filter(Boolean);

    return {
      profile,
      contextString: `
=== FAN PROFILE ===
${basicFacts || "No basic facts yet"}
Relationship: ${profile.relationship_state} | Level: ${profile.relationship_level?.toFixed(1)}/10
Messages: ${profile.message_count} | Stage: ${profile.stage}
Purchases: ${purchaseSummary}

${doNotAsk.length > 0 ? `=== NEVER ASK AGAIN ===\nYou already know their ${doNotAsk.join(", ")}. Do NOT ask.\n` : ""}
=== WHAT YOU KNOW ABOUT THIS FAN ===
${memoriesText}
${relevantText}

${summariesText ? `=== RECENT SESSION SUMMARIES ===\n${summariesText}\n` : ""}
`.trim()
    };
  } catch (err) {
    console.error("buildFanContext error:", err);
    return null;
  }
}

// ============================================================
// MESSAGES — Save và load chat history
// ============================================================

export async function saveMessage(chatId, { role, content, strategy = null, stage = null, media_type = null, file_id = null }) {
  if (!db()) return null;
  try {
    const { error } = await db()
      .from("messages")
      .insert({ chat_id: chatId, role, content, strategy, stage, media_type, file_id });
    if (error) console.error("saveMessage error:", error);
  } catch (e) {
    console.error("saveMessage exception:", e);
  }
}

export async function getMessages(chatId, limit = 50) {
  if (!db()) return [];
  try {
    const { data, error } = await db()
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) console.error("getMessages error:", error);
    return data || [];
  } catch (e) {
    return [];
  }
}

// ============================================================
// TAKEOVER — Admin can pause AI for a specific chat
// ============================================================

export async function checkTakeover(chatId) {
  if (!db()) return false;
  try {
    const { data } = await db()
      .from("takeovers")
      .select("is_active")
      .eq("chat_id", chatId)
      .single();
    return data?.is_active === true;
  } catch (e) {
    return false;
  }
}

export async function setTakeover(chatId, isActive) {
  if (!db()) return;
  try {
    await db().from("takeovers").upsert({
      chat_id: chatId,
      is_active: isActive,
      started_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("setTakeover error:", e);
  }
}
