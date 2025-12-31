const users = {};

export function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = {
      chatId,
      state: "stranger",
      relationship_level: 0,
      message_count: 0,
      last_sale_time: null,
      failed_sale_count: 0,
      created_at: Date.now(),
      last_active: Date.now()
    };
  }

  return users[chatId];
}

export function updateUser(chatId, updates) {
  const user = getUser(chatId);
  Object.assign(user, updates);
  user.last_active = Date.now();
  return user;
}
