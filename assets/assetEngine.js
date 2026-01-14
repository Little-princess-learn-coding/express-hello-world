import { ASSET_REGISTRY } from "./assetRegistry.js";

/**
 * Quyết định có gửi asset hay không
 */
export function assetDecisionEngine({
  user,
  intentData,
  currentSaleStrategy,
  timeContext
}) {
  // 1️⃣ HARD BLOCK
  if (user.state.relationship_state === "time_waster") return null;
  if (timeContext === "deep_night") return null;

  // 2️⃣ Decide asset type
  const assetType = decideAssetType({
    user,
    intentData,
    currentSaleStrategy
  });

  if (!assetType) return null;

  // 3️⃣ Select cụ thể asset
  const asset = selectAsset(assetType, user, intentData, currentSaleStrategy);
  if (!asset) return null;

  return asset;
}

/**
 * Chọn loại asset
 */
function decideAssetType({ user, intentData, currentSaleStrategy }) {
  // meme luôn ưu tiên cho cảm xúc
  if (intentData.intent === "flirt" || intentData.intent === "tease") {
    return "meme";
  }

  if (currentSaleStrategy === "gift") {
    return "gift";
  }

  if (
    intentData.intent === "ask_photo" &&
    user.state.relationship_state === "casual"
  ) {
    return "tease_selfie";
  }

  return null;
}

/**
 * Lấy asset cụ thể từ registry
 */
function selectAsset(type, user, intentData, currentSaleStrategy) {
  return ASSET_REGISTRY.find(asset => {
    if (asset.type !== type) return false;

    // đã gửi rồi thì skip
    if (
      asset.reusable_per_user === false &&
      user.sent_assets.includes(asset.asset_id)
    ) {
      return false;
    }

    // strategy requirement
    if (
      asset.requires_strategy &&
      asset.requires_strategy !== currentSaleStrategy
    ) {
      return false;
    }

    // state requirement
    if (
      asset.allowed_states &&
      !asset.allowed_states.includes(user.state.relationship_state)
    ) {
      return false;
    }

    return true;
  });
}
