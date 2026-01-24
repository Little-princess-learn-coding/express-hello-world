// state/userState.js

export const USER_STATES = {
  STRANGER: "stranger",      // User mới, chưa được sale lần nào
  CASUAL: "casual",          // Đã qua first sale nhưng decline
  SUPPORTER: "supporter",    // Đã support ít nhất 1 lần
  TIME_WASTER: "time_waster" // Fail 3 lần liên tiếp → ngưng reply
};

/**
 * Tạo user state ban đầu
 * SINGLE SOURCE OF TRUTH - không duplicate counters
 */
export function createInitialUserState() {
  return {
    // Relationship state
    relationship_state: USER_STATES.STRANGER,

    // Message tracking
    messageCount: 0,

    // Sale tracking - CONSOLIDATED (không duplicate với app.js)
    totalSaleAttempts: 0,      // Tổng số lần bot hỏi support (all time)
    totalSaleSuccess: 0,        // Tổng số lần user support thành công (all time)
    
    // Casual testing phase (2 cơ hội để lên supporter hoặc xuống time_waster)
    casualSaleAttempts: 0,      // Số lần sale khi đang ở casual state (max 2)

    // Weekly tracking
    weeklySaleAttempts: 0,      // Số lần sale trong tuần (reset mỗi 7 ngày)
    weeklyResetAt: Date.now(),

    // Timing
    lastSaleAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

/**
 * Gọi khi user gửi tin nhắn
 * Stranger → Casual after 3 messages (nếu chưa có sale)
 */
export function onUserMessage(userState) {
  userState.messageCount += 1;
  userState.updatedAt = Date.now();

  // Stranger tự động → casual sau 3 tin (fast lane)
  // Nhưng nếu đã có emotional connection thì ưu tiên first sale
  if (
    userState.relationship_state === USER_STATES.STRANGER &&
    userState.messageCount >= 3 &&
    userState.totalSaleAttempts === 0  // Chưa từng sale
  ) {
    // GIỮ LẠI stranger để trigger first_sale
    // Không auto chuyển casual
  }

  return userState;
}

/**
 * Gọi khi bot thử sale
 * Tăng counters, track casual attempts
 */
export function onSaleAttempt(userState) {
  userState.totalSaleAttempts += 1;
  userState.weeklySaleAttempts += 1;
  userState.lastSaleAt = Date.now();
  userState.updatedAt = Date.now();

  // Nếu đang ở casual → đếm số lần sale trong giai đoạn này
  if (userState.relationship_state === USER_STATES.CASUAL) {
    userState.casualSaleAttempts += 1;
  }

  return userState;
}

/**
 * Gọi khi user DECLINE sale
 * 
 * LOGIC:
 * - Stranger fail lần đầu → CASUAL (2 cơ hội còn lại)
 * - Casual fail 2 lần → TIME_WASTER
 */
export function onSaleFailure(userState) {
  userState.updatedAt = Date.now();

  // STRANGER fail → chuyển thành CASUAL
  if (userState.relationship_state === USER_STATES.STRANGER) {
    userState.relationship_state = USER_STATES.CASUAL;
    userState.casualSaleAttempts = 0;  // Reset counter cho giai đoạn casual
    console.log(`📊 Stranger → CASUAL after first sale failure (2 chances left)`);
  }
  
  // CASUAL fail → check xem đã hết 2 cơ hội chưa
  else if (userState.relationship_state === USER_STATES.CASUAL) {
    // Đã fail 2 lần trong giai đoạn casual → TIME_WASTER
    if (userState.casualSaleAttempts >= 2) {
      userState.relationship_state = USER_STATES.TIME_WASTER;
      console.log(`⛔ Casual → TIME_WASTER after 2 failures in casual phase`);
    } else {
      console.log(`⚠️  Casual failure ${userState.casualSaleAttempts}/2 - still has chances`);
    }
  }

  return userState;
}

/**
 * Gọi khi sale thành công
 * Upgrade to SUPPORTER (từ bất kỳ state nào trừ time_waster)
 */
export function onSaleSuccess(userState) {
  userState.totalSaleSuccess += 1;
  userState.updatedAt = Date.now();

  // Bất kỳ state nào (trừ time_waster) → SUPPORTER
  if (userState.relationship_state !== USER_STATES.TIME_WASTER) {
    const previousState = userState.relationship_state;
    userState.relationship_state = USER_STATES.SUPPORTER;
    console.log(`✅ ${previousState} → SUPPORTER (${userState.totalSaleSuccess} successful sales)`);
  }

  return userState;
}

/**
 * Reset weekly counter (gọi mỗi 7 ngày)
 */
export function resetWeeklyCounter(userState) {
  const now = Date.now();
  const weekInMs = 7 * 24 * 60 * 60 * 1000;

  if (now - userState.weeklyResetAt >= weekInMs) {
    console.log(`🔄 Weekly sale counter reset: ${userState.weeklySaleAttempts} → 0`);
    userState.weeklySaleAttempts = 0;
    userState.weeklyResetAt = now;
    userState.updatedAt = now;
  }

  return userState;
}

// =======================
// ====== HELPERS =======
// =======================

/**
 * Check có được phép thử sale không (basic check)
 * KHÔNG BAO GỒM weekly limit - đó là policy check
 */
export function canAttemptSale(userState) {
  // Time waster không được sale
  if (userState.relationship_state === USER_STATES.TIME_WASTER) {
    return false;
  }

  // Stranger chỉ được sale nếu emotional_ready
  // (check ở app.js)
  
  return true;
}

/**
 * Check weekly sale policy
 * Returns { allow: boolean, reason: string }
 */
export function checkWeeklySalePolicy(userState, userInitiated = false) {
  // Nếu user chủ động hỏi ảnh → BYPASS limit
  if (userInitiated) {
    return { 
      allow: true, 
      reason: "User-initiated (bypass limit)" 
    };
  }

  // Time waster → không bao giờ
  if (userState.relationship_state === USER_STATES.TIME_WASTER) {
    return { 
      allow: false, 
      reason: "User marked as time waster" 
    };
  }

  // Stranger → chỉ cho phép first sale
  if (userState.relationship_state === USER_STATES.STRANGER) {
    if (userState.totalSaleAttempts > 0) {
      return { 
        allow: false, 
        reason: "Stranger already had first sale" 
      };
    }
    return { 
      allow: true, 
      reason: "First sale for stranger" 
    };
  }

  // Check weekly limit (max 3 lần/tuần)
  if (userState.weeklySaleAttempts >= 3) {
    return { 
      allow: false, 
      reason: `Weekly limit reached (${userState.weeklySaleAttempts}/3)` 
    };
  }

  // Check cooldown (minimum 24h between sales)
  if (userState.lastSaleAt) {
    const hoursSinceLastSale = (Date.now() - userState.lastSaleAt) / (1000 * 60 * 60);
    if (hoursSinceLastSale < 24) {
      return { 
        allow: false, 
        reason: `Cooldown period (${Math.round(24 - hoursSinceLastSale)}h remaining)` 
      };
    }
  }

  return { allow: true, reason: "Policy check passed" };
}

/**
 * Check minimum sale requirement (ít nhất 1 lần/tuần)
 */
export function needsWeeklySale(userState) {
  // Stranger không cần (chưa vào hệ thống)
  if (userState.relationship_state === USER_STATES.STRANGER) {
    return false;
  }

  // Time waster không cần
  if (userState.relationship_state === USER_STATES.TIME_WASTER) {
    return false;
  }

  // Nếu tuần này chưa sale lần nào
  if (userState.weeklySaleAttempts === 0) {
    // Check xem đã qua 7 ngày chưa
    const daysSinceReset = (Date.now() - userState.weeklyResetAt) / (1000 * 60 * 60 * 24);
    
    // Nếu sắp hết tuần (>= 6 ngày) mà chưa sale → cần sale
    if (daysSinceReset >= 6) {
      return true;
    }
  }

  return false;
}

/**
 * User có phải supporter không?
 */
export function isSupporter(userState) {
  return userState.relationship_state === USER_STATES.SUPPORTER;
}

/**
 * User có phải time-waster không?
 */
export function isTimeWaster(userState) {
  return userState.relationship_state === USER_STATES.TIME_WASTER;
}

/**
 * User có phải stranger không?
 */
export function isStranger(userState) {
  return userState.relationship_state === USER_STATES.STRANGER;
}

/**
 * User có phải casual không?
 */
export function isCasual(userState) {
  return userState.relationship_state === USER_STATES.CASUAL;
}

/**
 * Get readable state summary
 */
export function getStateSummary(userState) {
  return {
    state: userState.relationship_state,
    messages: userState.messageCount,
    totalSales: userState.totalSaleAttempts,
    successfulSales: userState.totalSaleSuccess,
    casualSaleAttempts: userState.casualSaleAttempts || 0,  // Số lần sale trong giai đoạn casual
    weeklySales: userState.weeklySaleAttempts,
    daysSinceCreation: Math.floor((Date.now() - userState.createdAt) / (1000 * 60 * 60 * 24))
  };
}
