// ============================================================
// assetRegistry.js — Hybrid registry
// Memes: vẫn dùng file path từ GitHub
// Daily life, confirmations, gifts, tease_selfie, videos: dùng file_id từ Supabase
// ============================================================

import { createClient } from "@supabase/supabase-js";

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
} else {
  console.error("⚠️ assetRegistry: Supabase env vars missing");
}

// ============================================================
// MEMES — giữ nguyên file path (không đổi)
// ============================================================
export const MEME_REGISTRY = {
  "happy":                { type:"meme", path:"/assets/files/meme/happy.jpg",                metadata:{emotion:"happy",intensity:"medium",tone:"cute",context:"reply_fun"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "ahhh_playful":         { type:"meme", path:"/assets/files/meme/ahhh_playful.jpg",         metadata:{emotion:"playful",intensity:"high",tone:"cute",context:"reply_playful"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "angry":                { type:"meme", path:"/assets/files/meme/angry.jpg",                metadata:{emotion:"angry",intensity:"medium",tone:"angry",context:"reply_angry"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "annoyed":              { type:"meme", path:"/assets/files/meme/annoyed.jpg",              metadata:{emotion:"annoyed",intensity:"high",tone:"annoyed",context:"reply_angry"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "ashamed":              { type:"meme", path:"/assets/files/meme/ashamed.jpg",              metadata:{emotion:"ashamed",intensity:"medium",tone:"cute",context:"reply_shy"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "bored":                { type:"meme", path:"/assets/files/meme/bored.jpg",                metadata:{emotion:"bored",intensity:"medium",tone:"cute",context:"reply_bored"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "confident":            { type:"meme", path:"/assets/files/meme/confident.jpg",            metadata:{emotion:"flirt",intensity:"medium",tone:"playful",context:"reply_flirt"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "confused_questioning": { type:"meme", path:"/assets/files/meme/confused_questioning.jpg", metadata:{emotion:"confused",intensity:"medium",tone:"cute",context:"reply_confused"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "confused_speechless":  { type:"meme", path:"/assets/files/meme/confused_speechless.jpg",  metadata:{emotion:"confused",intensity:"medium",tone:"funny",context:"reply_confused"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "cry_loudly":           { type:"meme", path:"/assets/files/meme/cry_loudly.jpg",           metadata:{emotion:"sad",intensity:"high",tone:"dramatic",context:"reply_sad"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "cry_softly":           { type:"meme", path:"/assets/files/meme/cry_softly.jpg",           metadata:{emotion:"sad",intensity:"medium",tone:"cute",context:"reply_sad"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "delight_smile":        { type:"meme", path:"/assets/files/meme/delight_smile.jpg",        metadata:{emotion:"happy",intensity:"medium",tone:"cute",context:"reply_fun"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "disappointed":         { type:"meme", path:"/assets/files/meme/disappointed.jpg",         metadata:{emotion:"disappointed",intensity:"medium",tone:"cute",context:"reply_sad"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "disgusting":           { type:"meme", path:"/assets/files/meme/disgusting.jpg",           metadata:{emotion:"disgusting",intensity:"high",tone:"angry",context:"reply_angry"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "excited":              { type:"meme", path:"/assets/files/meme/excited.jpg",              metadata:{emotion:"excited",intensity:"high",tone:"playful",context:"reply_fun"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "flirty_teasing":       { type:"meme", path:"/assets/files/meme/flirty_teasing.jpg",       metadata:{emotion:"flirty",intensity:"high",tone:"teasing",context:"reply_tease"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "funny_confuse":        { type:"meme", path:"/assets/files/meme/funny_confuse.jpg",        metadata:{emotion:"confused",intensity:"medium",tone:"playful",context:"reply_confused"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "gloomy":               { type:"meme", path:"/assets/files/meme/gloomy.jpg",               metadata:{emotion:"upset",intensity:"high",tone:"upset",context:"reply_upset"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "hold_back_tear":       { type:"meme", path:"/assets/files/meme/hold_back_tear.jpg",       metadata:{emotion:"upset",intensity:"medium",tone:"playful",context:"reply_playful"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "horny":                { type:"meme", path:"/assets/files/meme/horny.jpg",                metadata:{emotion:"horny",intensity:"high",tone:"flirty",context:"reply_flirt"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "mad":                  { type:"meme", path:"/assets/files/meme/mad.jpg",                  metadata:{emotion:"angry",intensity:"high",tone:"dramatic",context:"reply_angry"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "nonchalant":           { type:"meme", path:"/assets/files/meme/nonchalant.jpg",           metadata:{emotion:"nonchalant",intensity:"medium",tone:"nonchalant",context:"reply_upset"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "possessive_teasing":   { type:"meme", path:"/assets/files/meme/possessive_teasing.jpg",   metadata:{emotion:"possessive",intensity:"high",tone:"teasing",context:"reply_tease"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "shy":                  { type:"meme", path:"/assets/files/meme/shy.jpg",                  metadata:{emotion:"shy",intensity:"medium",tone:"cute",context:"reply_shy"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "smug":                 { type:"meme", path:"/assets/files/meme/smug.jpg",                 metadata:{emotion:"smug",intensity:"medium",tone:"teasing",context:"reply_tease"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "surprised":            { type:"meme", path:"/assets/files/meme/surprised.jpg",            metadata:{emotion:"surprised",intensity:"medium",tone:"cute",context:"reply_fun"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
  "tired":                { type:"meme", path:"/assets/files/meme/tired.jpg",                metadata:{emotion:"tired",intensity:"medium",tone:"cute",context:"reply_bored"}, reusable:"unlimited", auto_delete:false, sale_sensitive:false },
};

// ============================================================
// IN-MEMORY CACHE — tránh query Supabase liên tục
// ============================================================
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 phút

async function getSupabaseAssets() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  if (!supabase) return {};
  try {
    const { data, error } = await supabase
      .from("asset_registry")
      .select("*")
      .eq("is_active", true);
    if (error) throw error;

    // Convert array → object keyed by asset_id
    const registry = {};
    for (const asset of data) {
      registry[asset.asset_id] = {
        type: asset.asset_type,
        file_id: asset.file_id,
        media_type: asset.media_type || "photo",
        metadata: asset.metadata || {},
        reusable_per_user: asset.reusable_per_user,
        auto_delete: asset.auto_delete,
        allowed_states: asset.allowed_states || ["casual", "supporter"],
        requires_support: asset.requires_support || false,
        ttl: asset.ttl,
        strategy_id: asset.strategy_id,
        linked_gift_id: asset.linked_gift_id,
      };
    }
    _cache = registry;
    _cacheTime = Date.now();
    return registry;
  } catch (e) {
    console.error("assetRegistry: Supabase fetch error:", e.message);
    return _cache || {};
  }
}

// Force refresh cache (gọi sau khi /register xong)
export function invalidateAssetCache() {
  _cache = null;
  _cacheTime = 0;
}

// ============================================================
// PUBLIC API
// ============================================================

// Lấy asset bằng asset_id — tự động phân biệt meme vs Supabase
export async function getAsset(assetId) {
  // Meme → file path (GitHub)
  if (MEME_REGISTRY[assetId]) return MEME_REGISTRY[assetId];
  // Còn lại → Supabase
  const registry = await getSupabaseAssets();
  return registry[assetId] || null;
}

// Lấy tất cả assets theo type
export async function getAssetsByType(type) {
  if (type === "meme") {
    return Object.entries(MEME_REGISTRY).map(([id, asset]) => ({ ...asset, asset_id: id }));
  }
  const registry = await getSupabaseAssets();
  return Object.entries(registry)
    .filter(([_, a]) => a.type === type)
    .map(([id, asset]) => ({ ...asset, asset_id: id }));
}

// Lấy random asset theo type (dùng trong assetEngine)
export async function getRandomAssetByType(type, excludeIds = []) {
  const assets = await getAssetsByType(type);
  const available = assets.filter(a => !excludeIds.includes(a.asset_id));
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Lấy confirmation asset theo linked_gift_id
export async function getConfirmationForGift(giftId) {
  const registry = await getSupabaseAssets();
  const found = Object.entries(registry).find(
    ([_, a]) => a.type === "confirmation" && a.linked_gift_id === giftId
  );
  return found ? { ...found[1], asset_id: found[0] } : null;
}

// ============================================================
// REGISTER ASSET — gọi khi bot nhận /register từ channel
// ============================================================
export async function registerAsset({ assetId, assetType, fileId, mediaType = "photo", metadata = {}, options = {} }) {
  if (!supabase) return { ok: false, error: "Supabase not initialized" };
  try {
    const { error } = await supabase
      .from("asset_registry")
      .upsert({
        asset_id: assetId,
        asset_type: assetType,
        file_id: fileId,
        media_type: mediaType,
        metadata,
        reusable_per_user: options.reusable_per_user ?? false,
        auto_delete: options.auto_delete ?? true,
        allowed_states: options.allowed_states ?? ["casual", "supporter"],
        requires_support: options.requires_support ?? false,
        ttl: options.ttl ?? null,
        strategy_id: options.strategy_id ?? null,
        linked_gift_id: options.linked_gift_id ?? null,
        is_active: true,
      }, { onConflict: "asset_id" });

    if (error) throw error;
    invalidateAssetCache();
    console.log(`✅ Asset registered: ${assetId} [${assetType}] file_id: ${fileId}`);
    return { ok: true };
  } catch (e) {
    console.error("registerAsset error:", e.message);
    return { ok: false, error: e.message };
  }
}

// ============================================================
// LIST assets từ Supabase (dùng trong dashboard)
// ============================================================
export async function listAssets(type = null) {
  const registry = await getSupabaseAssets();
  const all = Object.entries(registry).map(([id, a]) => ({ ...a, asset_id: id }));
  return type ? all.filter(a => a.type === type) : all;
}
