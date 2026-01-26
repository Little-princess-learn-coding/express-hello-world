{
  "memes": {
    "happy": {
      "type": "meme",
      "path": "/assets/files/meme/happy.jpg",
      "metadata": {
        "emotion": "happy",
        "intensity": "medium",
        "tone": "cute",
        "context": "reply_fun"
      },
      "reusable": "unlimited",
      "auto_delete": false,
      "sale_sensitive": false
    },
    "shy_flustered": {
      "type": "meme",
      "path": "/assets/files/meme/shy_flustered.jpg",
      "metadata": {
        "emotion": "shy",
        "intensity": "high",
        "tone": "cute",
        "context": "reply_flirt"
      },
      "reusable": "unlimited",
      "auto_delete": false,
      "sale_sensitive": false
    },
    "playful_teasing": {
      "type": "meme",
      "path": "/assets/files/meme/playful_teasing.jpg",
      "metadata": {
        "emotion": "playful",
        "intensity": "medium",
        "tone": "flirty",
        "context": "reply_tease"
      },
      "reusable": "unlimited",
      "auto_delete": false,
      "sale_sensitive": false
    },
    "surprised_shocked": {
      "type": "meme",
      "path": "/assets/files/meme/surprised_shocked.jpg",
      "metadata": {
        "emotion": "surprised",
        "intensity": "high",
        "tone": "dramatic",
        "context": "reply_shock"
      },
      "reusable": "unlimited",
      "auto_delete": false,
      "sale_sensitive": false
    },
    "excited_happy": {
      "type": "meme",
      "path": "/assets/files/meme/excited_happy.jpg",
      "metadata": {
        "emotion": "excited",
        "intensity": "high",
        "tone": "cute",
        "context": "reply_flirt"
      },
      "reusable": "unlimited",
      "auto_delete": false,
      "sale_sensitive": false
    }
  },
  
  "gift_images": {
    "nails_pink": {
      "type": "gift_image",
      "path": "/assets/files/gifts/nails_pink.jpg",
      "send_gift_image": true,
      "confirmation_asset_id": "nails_pink_received",
      "metadata": {
        "item_type": "nails",
        "price_range": "medium",
        "desire_level": "strong",
        "description": "Pink nail set"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_strategy": "gift",
      "strategy_id": 1
    },
    "bag_blue": {
      "type": "gift_image",
      "path": "/assets/files/gifts/bag_blue.jpg",
      "send_gift_image": true,
      "confirmation_asset_id": "bag_blue_received",
      "metadata": {
        "item_type": "bag",
        "price_range": "high",
        "desire_level": "strong",
        "description": "Blue cute bag",
        "color": "blue"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_strategy": "gift",
      "strategy_id": 1
    },
    "bag_pink": {
      "type": "gift_image",
      "path": "/assets/files/gifts/bag_pink.jpg",
      "send_gift_image": true,
      "confirmation_asset_id": "bag_pink_received",
      "metadata": {
        "item_type": "bag",
        "price_range": "high",
        "desire_level": "strong",
        "description": "Pink luxury bag",
        "color": "pink"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_strategy": "gift",
      "strategy_id": 1
    },
    "milktea_taro": {
      "type": "gift_image",
      "path": null,
      "send_gift_image": false,
      "confirmation_asset_id": "milktea_taro_received",
      "metadata": {
        "item_type": "drink",
        "price_range": "low",
        "desire_level": "subtle",
        "description": "Taro milktea",
        "flavor": "taro"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_strategy": "gift",
      "strategy_id": 1
    },
    "milktea_brown_sugar": {
      "type": "gift_image",
      "path": null,
      "send_gift_image": false,
      "confirmation_asset_id": "milktea_brown_sugar_received",
      "metadata": {
        "item_type": "drink",
        "price_range": "low",
        "desire_level": "subtle",
        "description": "Brown sugar milktea",
        "flavor": "brown_sugar"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_strategy": "gift",
      "strategy_id": 1
    },
    "snacks_comfort": {
      "type": "gift_image",
      "path": null,
      "send_gift_image": false,
      "confirmation_asset_id": "snacks_received",
      "metadata": {
        "item_type": "food",
        "price_range": "low",
        "desire_level": "subtle",
        "description": "Comfort snacks"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_strategy": "jealousy",
      "strategy_id": 2
    }
  },

  "daily_life": {
    "food_ramen": {
      "type": "daily_life",
      "path": "/assets/files/daily_life/food_ramen.jpg",
      "metadata": {
        "scene": "food",
        "mood": "happy"
      },
      "reusable_per_user": false,
      "auto_delete": true,
      "allowed_states": ["casual", "supporter"]
    },
    "cafe_studying": {
      "type": "daily_life",
      "path": "/assets/files/daily_life/cafe_study.jpg",
      "metadata": {
        "scene": "cafe",
        "mood": "chill"
      },
      "reusable_per_user": false,
      "auto_delete": true,
      "allowed_states": ["casual", "supporter"]
    }
  },

  "post_support_confirmation": {
    "nails_pink_received": {
      "type": "post_support_confirmation",
      "path": "/assets/files/confirmations/nails_pink_received.jpg",
      "linked_gift_id": "nails_pink",
      "metadata": {
        "delay_minutes": 10080,
        "description": "Aurelia showing pink nails - EXACT MATCH to nails_pink gift"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_support": true,
      "send_delay_required": true
    },
    "bag_blue_received": {
      "type": "post_support_confirmation",
      "path": "/assets/files/confirmations/bag_blue_received.jpg",
      "linked_gift_id": "bag_blue",
      "metadata": {
        "delay_minutes": 10080,
        "description": "Aurelia with blue bag - EXACT MATCH to bag_blue gift"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_support": true,
      "send_delay_required": true
    },
    "bag_pink_received": {
      "type": "post_support_confirmation",
      "path": "/assets/files/confirmations/bag_pink_received.jpg",
      "linked_gift_id": "bag_pink",
      "metadata": {
        "delay_minutes": 10080,
        "description": "Aurelia with pink bag - EXACT MATCH to bag_pink gift"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_support": true,
      "send_delay_required": true
    },
    "milktea_taro_received": {
      "type": "post_support_confirmation",
      "path": "/assets/files/confirmations/milktea_taro_received.jpg",
      "linked_gift_id": "milktea_taro",
      "metadata": {
        "delay_minutes": 15,
        "description": "Aurelia drinking taro milktea - EXACT MATCH to milktea_taro gift"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_support": true,
      "send_delay_required": true
    },
    "milktea_brown_sugar_received": {
      "type": "post_support_confirmation",
      "path": "/assets/files/confirmations/milktea_brown_sugar_received.jpg",
      "linked_gift_id": "milktea_brown_sugar",
      "metadata": {
        "delay_minutes": 18,
        "description": "Aurelia drinking brown sugar milktea - EXACT MATCH to milktea_brown_sugar gift"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_support": true,
      "send_delay_required": true
    },
    "snacks_received": {
      "type": "post_support_confirmation",
      "path": "/assets/files/confirmations/snacks_received.jpg",
      "linked_gift_id": "snacks_comfort",
      "metadata": {
        "delay_minutes": 30,
        "description": "Aurelia eating snacks - EXACT MATCH to snacks_comfort gift"
      },
      "reusable_per_user": false,
      "auto_delete": false,
      "requires_support": true,
      "send_delay_required": true
    }
  },

  "exclusive_selfies": {
    "reward_1": {
      "type": "exclusive_selfie",
      "path": "/assets/files/tease_selfie/exclusive_1.jpg",
      "metadata": {
        "exclusivity_level": "high",
        "tease_level": "medium"
      },
      "reusable_per_user": false,
      "auto_delete": true,
      "ttl": 25,
      "requires_support": true,
      "strategy_id": 5
    },
    "reward_2": {
      "type": "exclusive_selfie",
      "path": "/assets/files/tease_selfie/exclusive_2.jpg",
      "metadata": {
        "exclusivity_level": "high",
        "tease_level": "high"
      },
      "reusable_per_user": false,
      "auto_delete": true,
      "ttl": 20,
      "requires_support": true,
      "strategy_id": 5
    }
  },

  "tease_selfies": {
    "flirt_1": {
      "type": "tease_selfie",
      "path": "/assets/files/tease_selfie/tease_1.jpg",
      "metadata": {
        "tease_level": "medium"
      },
      "reusable_per_user": false,
      "auto_delete": true,
      "ttl": 25,
      "strategy_id": 7
    },
    "flirt_2": {
      "type": "tease_selfie",
      "path": "/assets/files/tease_selfie/tease_2.jpg",
      "metadata": {
        "tease_level": "high"
      },
      "reusable_per_user": false,
      "auto_delete": true,
      "ttl": 20,
      "strategy_id": 7
    }
  },

  "teaser_videos": {
    "album_preview_1": {
      "type": "teaser_video",
      "path": "/assets/files/videos/teaser_1.mp4",
      "metadata": {
        "duration": 3,
        "purpose": "tease"
      },
      "reusable_per_user": "limited",
      "auto_delete": false,
      "strategy_id": 4
    },
    "redirect_kofi": {
      "type": "teaser_video",
      "path": "/assets/files/videos/kofi_redirect.mp4",
      "metadata": {
        "duration": 5,
        "purpose": "redirect to ko-fi"
      },
      "reusable_per_user": "limited",
      "auto_delete": false,
      "strategy_id": 4
    }
  }
}
