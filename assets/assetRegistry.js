export const ASSET_REGISTRY = [
  {
    asset_id: "meme_shy_01",
    type: "meme",
    emotion: ["shy"],
    tone: "cute",
    reusable_per_user: true,
    auto_delete: true,
    ttl: 25
  },

  {
    asset_id: "gift_nails_black_01",
    type: "gift",
    item_type: "nails",
    reusable_per_user: false,
    auto_delete: false,
    requires_strategy: "gift"
  },

  {
    asset_id: "confirm_nails_black_01",
    type: "confirmation",
    item_type: "nails",
    reusable_per_user: false,
    auto_delete: false,
    requires_support: true
  }
];
