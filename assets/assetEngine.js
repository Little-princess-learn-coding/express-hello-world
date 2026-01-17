const fs = require('fs');
const path = require('path');

// Load asset registry
const assetRegistry = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'assetRegistry.json'), 'utf8')
);

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
function canReceiveAsset(chatId, assetId, assetData) {
  const history = initUserAssets(chatId);

  // Memes are always reusable
  if (assetData.reusable === 'unlimited') {
    return true;
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
function markAssetSent(chatId, assetId) {
  const history = initUserAssets(chatId);
  history.received.push(assetId);
  history.last_asset_sent = {
    assetId,
    timestamp: Date.now()
  };
}

/**
 * Schedule post-support confirmation asset
 * @param {string} chatId - User's chat ID
 * @param {string} giftAssetId - The gift asset ID that was sent
 * @param {object} giftAsset - The complete gift asset object
 */
function scheduleConfirmation(chatId, giftAssetId, giftAsset) {
  const history = initUserAssets(chatId);
  
  // Check if this gift has a linked confirmation
  if (!giftAsset.confirmation_asset_id) {
    console.log(`⚠️ Gift ${giftAssetId} has no linked confirmation`);
    return null;
  }
  
  const confirmationAssetId = giftAsset.confirmation_asset_id;
  
  // Find the confirmation asset in registry
  let confirmationAsset = null;
  
  for (const confirmId in assetRegistry.post_support_confirmation) {
    if (confirmId === confirmationAssetId) {
      confirmationAsset = assetRegistry.post_support_confirmation[confirmId];
      break;
    }
  }
  
  if (!confirmationAsset) {
    console.log(`❌ Confirmation asset ${confirmationAssetId} not found in registry`);
    return null;
  }
  
  // Verify the link is correct (double-check)
  if (confirmationAsset.linked_gift_id !== giftAssetId) {
    console.log(`⚠️ WARNING: Confirmation ${confirmationAssetId} links to ${confirmationAsset.linked_gift_id} but we sent ${giftAssetId}`);
    // Still proceed but log the mismatch
  }
  
  const delayMs = confirmationAsset.metadata.delay_minutes * 60 * 1000;
  
  history.pending_confirmations.push({
    confirmationAssetId: confirmationAssetId,
    giftAssetId: giftAssetId,
    scheduledFor: Date.now() + delayMs,
    asset: {
      assetId: confirmationAssetId,
      ...confirmationAsset
    }
  });
  
  console.log(`✅ Scheduled confirmation ${confirmationAssetId} for gift ${giftAssetId} in ${confirmationAsset.metadata.delay_minutes} minutes`);
  
  return {
    confirmationAssetId,
    giftAssetId,
    delayMs,
    asset: confirmationAsset
  };
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
 * Returns: { asset, shouldScheduleConfirmation }
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
    markAssetSent(chatId, asset.assetId);
    
    // Check if this is a gift image that needs confirmation scheduling
    const shouldScheduleConfirmation = (
      asset.type === 'gift_image' && 
      asset.confirmation_asset_id !== undefined
    );
    
    return {
      asset,
      shouldScheduleConfirmation
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
  canReceiveAsset
};
