const fs = require('fs');
const path = require('path');

// Load asset registry — memes vẫn dùng sync require, Supabase assets dùng async API
const assetRegistry = require('./assetRegistry.js');
// Supabase async API (new registry)
let _getConfirmationForGift = null;
import('./assetRegistry.js').then(m => {
  _getConfirmationForGift = m.getConfirmationForGift;
}).catch(e => console.error('assetEngine: failed to load async registry:', e.message));

// Track what assets each user has received
const userAssetHistory = {};

/**
 * Initialize user asset history
 */
function initUserAssets(chatId) {
  if (!userAssetHistory[chatId]) {
    userAssetHistory[chatId] = {
      received: [], // list of asset IDs user has received
      pending_confirmations: [], // assets waiting to be sent (post-support)
      last_meme_sent: null,
      last_asset_sent: null
    };
  }
  return userAssetHistory[chatId];
}

/**
 * Check if user can receive this asset
 */
function canReceiveAsset(chatId, assetId, assetData, userState = null) {
  const history = initUserAssets(chatId);

  // Memes are always reusable
  if (assetData.reusable === 'unlimited') {
    return true;
  }

  // Check requires_support — asset chỉ gửi được nếu user đã từng mua
  if (assetData.requires_support === true) {
    const hasPurchased = userState && (userState.successfulSales > 0);
    if (!hasPurchased) {
      console.log(`🔒 Asset ${assetId} requires support — user has not purchased yet`);
      return false;
    }
  }

  // Check if already received (for non-reusable assets)
  if (assetData.reusable_per_user === false) {
    if (history.received.includes(assetId)) {
      return false;
    }
  }

  // Limited reusable - check count (you can add counter logic here)
  if (assetData.reusable_per_user === 'limited') {
    const count = history.received.filter(id => id === assetId).length;
    if (count >= 2) return false; // max 2 times
  }

  return true;
}

/**
 * Get asset by strategy and type
 * @param {number} strategyId - Strategy number (1-7)
 * @param {string} assetType - Type of asset needed
 * @param {string} chatId - User's chat ID
 * @param {object} filters - Additional filters (optional)
 */
function getAssetForStrategy(strategyId, assetType, chatId, filters = {}) {
  const history = initUserAssets(chatId);
  let candidates = [];

  // Search through all asset categories
  for (const category in assetRegistry) {
    const assets = assetRegistry[category];
    
    for (const assetId in assets) {
      const asset = assets[assetId];
      
      // Match type
      if (asset.type !== assetType) continue;
      
      // Match strategy if specified
      if (asset.strategy_id && asset.strategy_id !== strategyId) continue;
      
      // Check if user can receive
      if (!canReceiveAsset(chatId, assetId, asset)) continue;
      
      // Apply additional filters
      let matchesFilters = true;
      if (filters.metadata) {
        for (const key in filters.metadata) {
          if (asset.metadata[key] !== filters.metadata[key]) {
            matchesFilters = false;
            break;
          }
        }
      }
      
      if (matchesFilters) {
        candidates.push({ assetId, ...asset });
      }
    }
  }

  // Return random candidate if multiple options
  if (candidates.length > 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  return null;
}

/**
 * Get meme by emotion and context
 */
function getMeme(chatId, emotion, intensity = 'medium', tone = 'cute') {
  let candidates = [];

  for (const memeId in assetRegistry.memes) {
    const meme = assetRegistry.memes[memeId];
    
    if (
      meme.metadata.emotion === emotion &&
      meme.metadata.intensity === intensity &&
      meme.metadata.tone === tone
    ) {
      candidates.push({ assetId: memeId, ...meme });
    }
  }

  // Fallback: just match emotion if no exact match
  if (candidates.length === 0) {
    for (const memeId in assetRegistry.memes) {
      const meme = assetRegistry.memes[memeId];
      if (meme.metadata.emotion === emotion) {
        candidates.push({ assetId: memeId, ...meme });
      }
    }
  }

  if (candidates.length > 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  return null;
}

/**
 * Mark asset as sent to user
 */
function markAssetSent(chatId, assetId, assetData = null) {
  const history = initUserAssets(chatId);
  history.received.push(assetId);
  history.last_asset_sent = {
    assetId,
    timestamp: Date.now(),
    ...(assetData || {})  // lưu full asset object để getLastSentGift có thể check type
  };
}

/**
 * Schedule post-support confirmation asset
 * Schema mới (Supabase): confirmation có linked_gift_id trỏ về gift
 * → dùng getConfirmationForGift(giftAssetId) để tìm đúng confirmation
 * @param {string} chatId - User's chat ID
 * @param {string} giftAssetId - The gift asset ID that was sent
 * @param {object} giftAsset - The complete gift asset object
 */
async function scheduleConfirmation(chatId, giftAssetId, giftAsset) {
  const history = initUserAssets(chatId);

  // Tìm confirmation asset qua linked_gift_id (Supabase schema mới)
  let confirmationAsset = null;
  let confirmationAssetId = null;

  if (_getConfirmationForGift) {
    // ✅ Supabase path — tìm confirmation có linked_gift_id = giftAssetId
    const found = await _getConfirmationForGift(giftAssetId);
    if (found) {
      confirmationAsset = found;
      confirmationAssetId = found.asset_id;
    }
  } else {
    // 🔁 Fallback legacy — tìm trong hardcoded registry cũ
    const legacyId = giftAsset.confirmation_asset_id;
    if (legacyId && assetRegistry.post_support_confirmation?.[legacyId]) {
      confirmationAsset = assetRegistry.post_support_confirmation[legacyId];
      confirmationAssetId = legacyId;
    }
  }

  if (!confirmationAsset || !confirmationAssetId) {
    console.log(`⚠️ No confirmation found for gift ${giftAssetId}`);
    return null;
  }

  const delayMinutes = confirmationAsset.metadata?.delay_minutes ?? 0;
  const delayMs = delayMinutes * 60 * 1000;

  history.pending_confirmations.push({
    confirmationAssetId,
    giftAssetId,
    scheduledFor: Date.now() + delayMs,
    asset: {
      assetId: confirmationAssetId,
      ...confirmationAsset
    }
  });

  console.log(`✅ Scheduled confirmation ${confirmationAssetId} for gift ${giftAssetId} in ${delayMinutes} minutes`);

  return {
    confirmationAssetId,
    giftAssetId,
    delayMs,
    asset: confirmationAsset
  };
}

/**
 * Get the last gift asset sent to user — dùng để match confirmation
 */
function getLastSentGift(chatId) {
  const history = initUserAssets(chatId);
  // Tìm ngược từ cuối danh sách received, lấy asset đầu tiên có type 'gift'
  for (let i = history.received.length - 1; i >= 0; i--) {
    const assetId = history.received[i];
    // Tìm trong registry (cả meme registry lẫn Supabase cache đều ko có gift, nhưng
    // last_asset_sent lưu full object nên dùng cái đó)
    if (
      history.last_asset_sent &&
      history.last_asset_sent.assetId === assetId &&
      (history.last_asset_sent.type === 'gift' || history.last_asset_sent.type === 'gift_image')
    ) {
      return history.last_asset_sent;
    }
  }
  // Fallback: trả về last_asset_sent nếu là gift
  if (
    history.last_asset_sent &&
    (history.last_asset_sent.type === 'gift' || history.last_asset_sent.type === 'gift_image')
  ) {
    return history.last_asset_sent;
  }
  return null;
}

/**
 * Get pending confirmations ready to send
 */
function getPendingConfirmations(chatId) {
  const history = initUserAssets(chatId);
  const now = Date.now();
  
  const ready = history.pending_confirmations.filter(
    conf => conf.scheduledFor <= now
  );
  
  // Remove sent confirmations
  history.pending_confirmations = history.pending_confirmations.filter(
    conf => conf.scheduledFor > now
  );
  
  return ready;
}

/**
 * Build asset sending instructions for AI
 * This generates the prompt telling AI what assets are available
 */
function buildAssetInstructions(strategyId, chatId, userState) {
  let instructions = '\n\n=== AVAILABLE ASSETS ===\n';
  
  // Strategy-specific assets
  switch(strategyId) {
    case 1: // Gift Strategy
      instructions += 'You can send a GIFT IMAGE by using: [SEND_ASSET:gift_image]\n';
      instructions += 'Use this when showing Aurelia what gift she desires.\n';
      break;
      
    case 2: // Jealousy Strategy
      instructions += 'You can send SNACK/COMFORT food image: [SEND_ASSET:gift_image:snacks]\n';
      break;
      
    case 3: // Feeling Unwell Strategy
      instructions += 'You can send COMFORT food/drink image: [SEND_ASSET:gift_image:comfort]\n';
      break;
      
    case 4: // Upcoming Album Strategy
      instructions += 'You can send a TEASER VIDEO: [SEND_ASSET:teaser_video]\n';
      instructions += 'Use this to build anticipation for the new album.\n';
      break;
      
    case 5: // Joke Reward Strategy
      instructions += 'If user WINS the challenge, send: [SEND_ASSET:exclusive_selfie]\n';
      instructions += 'If user LOSES, send: [SEND_ASSET:gift_image:milktea]\n';
      break;
      
    case 6: // Roleplay Fantasy Strategy
      // Usually no asset needed unless context requires
      break;
      
    case 7: // Exclusive Desire Strategy
      instructions += 'You can send a TEASE SELFIE: [SEND_ASSET:tease_selfie]\n';
      instructions += 'Use this when conversation is very flirty/spicy.\n';
      break;
  }
  
  // Memes are always available
  instructions += '\nMEMES (always available): [SEND_MEME:emotion]\n';
  instructions += 'Available emotions: happy, shy, playful, teasing, flustered, surprised\n';
  instructions += 'Example: [SEND_MEME:shy] or [SEND_MEME:playful]\n';
  
  instructions += '\n=== IMPORTANT RULES ===\n';
  instructions += '- Only use asset markers if it NATURALLY fits the conversation\n';
  instructions += '- NEVER mention the markers in your text response\n';
  instructions += '- Asset markers should be on a separate line\n';
  instructions += '- Maximum 1 asset per response\n';
  
  return instructions;
}

/**
 * Parse AI response for asset markers
 */
function parseAssetMarkers(aiResponse) {
  const markers = {
    hasAsset: false,
    assetType: null,
    assetSubtype: null,
    emotion: null,
    cleanResponse: aiResponse
  };
  
  // Check for SEND_ASSET marker
  const assetMatch = aiResponse.match(/\[SEND_ASSET:(\w+)(?::(\w+))?\]/);
  if (assetMatch) {
    markers.hasAsset = true;
    markers.assetType = assetMatch[1]; // e.g., "gift_image"
    markers.assetSubtype = assetMatch[2] || null; // e.g., "snacks"
    markers.cleanResponse = aiResponse.replace(/\[SEND_ASSET:.*?\]/, '').trim();
  }
  
  // Check for SEND_MEME marker
  const memeMatch = aiResponse.match(/\[SEND_MEME:(\w+)\]/);
  if (memeMatch) {
    markers.hasAsset = true;
    markers.assetType = 'meme';
    markers.emotion = memeMatch[1]; // e.g., "shy"
    markers.cleanResponse = aiResponse.replace(/\[SEND_MEME:.*?\]/, '').trim();
  }
  
  return markers;
}

/**
 * Get the actual asset file to send
 * Returns: { asset, shouldScheduleConfirmation, shouldSendImage }
 */
function getAssetToSend(markers, strategyId, chatId) {
  if (!markers.hasAsset) return null;
  
  let asset = null;
  
  if (markers.assetType === 'meme') {
    asset = getMeme(chatId, markers.emotion);
  } else {
    // Get asset by type and strategy
    const filters = markers.assetSubtype ? {
      metadata: { item_type: markers.assetSubtype }
    } : {};
    
    asset = getAssetForStrategy(strategyId, markers.assetType, chatId, filters);
  }
  
  if (asset) {
    markAssetSent(chatId, asset.assetId, asset);  // lưu full object
    
    // Check if this gift has a linked confirmation
    // Schema mới (Supabase): confirmation có linked_gift_id → dùng asset.type === 'gift'
    // Schema cũ (legacy): gift có confirmation_asset_id
    const shouldScheduleConfirmation = (
      asset.type === 'gift' ||
      (asset.type === 'gift_image' && asset.confirmation_asset_id !== undefined)
    );
    
    // Check if we should actually send the image (for food/drink, might be text-only)
    // Ưu tiên metadata.send_image (set khi /register), fallback sang send_gift_image (legacy)
    const shouldSendImage = asset.metadata?.send_image !== false && asset.send_gift_image !== false;
    
    return {
      asset,
      shouldScheduleConfirmation,
      shouldSendImage
    };
  }
  
  return null;
}

module.exports = {
  initUserAssets,
  getAssetForStrategy,
  getMeme,
  markAssetSent,
  scheduleConfirmation,
  getPendingConfirmations,
  buildAssetInstructions,
  parseAssetMarkers,
  getAssetToSend,
  canReceiveAsset,
  getLastSentGift,
};
