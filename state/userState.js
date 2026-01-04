// state/userState.js

export const USER_STATES = {
  STRANGER: "stranger",
  CASUAL: "casual",
  SUPPORTER: "supporter",
  TIME_WASTER: "time_waster"
};

// tạo user state ban đầu
export function createInitialUserState() {
  return {
    relationship_state: USER_STATES.STRANGER,

    messageCount: 0,

    saleAttempts: 0,
    saleSuccessCount: 0,

    lastSaleAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// gọi khi user gửi tin nhắn
export function onUserMessage(userState) {
  userState.messageCount += 1;
  userState.updatedAt = Date.now();

  // stranger -> casual sau khi nói chuyện đủ lâu
  if (
    userState.relationship_state === USER_STATES.STRANGER &&
    userState.messageCount >= 3
  ) {
    userState.relationship_state = USER_STATES.CASUAL;
  }

  return userState;
}

// gọi khi bot thử sale
export function onSaleAttempt(userState) {
  userState.saleAttempts += 1;
  userState.lastSaleAt = Date.now();
  userState.updatedAt = Date.now();

  // casual -> time_waster nếu fail 3 lần
  if (
    userState.relationship_state === USER_STATES.CASUAL &&
    userState.saleAttempts >= 3 &&
    userState.saleSuccessCount === 0
  ) {
    userState.relationship_state = USER_STATES.TIME_WASTER;
  }

  return userState;
}

// gọi khi sale thành công
export function onSaleSuccess(userState) {
  userState.saleSuccessCount += 1;
  userState.updatedAt = Date.now();

  // bất kỳ state nào (trừ time_waster) -> supporter
  if (userState.relationship_state !== USER_STATES.TIME_WASTER) {
    userState.relationship_state = USER_STATES.SUPPORTER;
  }

  return userState;
}

// =======================
// ====== HELPERS =======
// =======================

// có được phép thử sale không?
export function canAttemptSale(userState) {
  if (userState.relationship_state === USER_STATES.STRANGER) return false;
  if (userState.relationship_state === USER_STATES.TIME_WASTER) return false;

  return true;
}

// có nên đầu tư cảm xúc không?
export function shouldInvestEmotion(userState) {
  return userState.relationship_state !== USER_STATES.TIME_WASTER;
}

// user có phải supporter không?
export function isSupporter(userState) {
  return userState.relationship_state === USER_STATES.SUPPORTER;
}

// user có phải time-waster không?
export function isTimeWaster(userState) {
  return userState.relationship_state === USER_STATES.TIME_WASTER;
}
