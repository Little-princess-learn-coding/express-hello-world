import fetch from 'node-fetch';
import {
  getTopicId,
  saveTopicId,
  setWaitingAdmin,
  isWaitingAdmin,
  getUserIdByTopicId,
  updateLastAlertTime,
  getLastAlertTime
} from './monitoringDb.js';  // ✅ bỏ "user_monitoring/"

// ================== CONFIGURATION ==================
// Dùng TELEGRAM_AURELIABOT_TOKEN giống với app.js gốc của bạn
const BOT_TOKEN = process.env.TELEGRAM_AURELIABOT_TOKEN;
const FORUM_GROUP_ID = process.env.FORUM_GROUP_ID ? parseInt(process.env.FORUM_GROUP_ID) : null;
const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
  : [];

// ================== KEYWORDS ==================
// Danh sách keywords cần admin can thiệp
// Dùng word boundary (\b) nên "ai" sẽ match "ai" nhưng không match "again", "paid", v.v.
const INTERVENTION_KEYWORDS = [
  // Bot/AI detection
  'are you ai',
  'are you a bot',
  'are you real',
  'are you fake',
  'you are ai',
  'you are a bot',
  'you are fake',
  'you are not real',
  'is this ai',
  'is this a bot',
  'is this real',
  'not real',
  'prove it',
  'prove you are real',
  'prove you\'re real',

  // Single keywords - match exact word
  'chatbot',
  'robot',
  'artificial intelligence',
  'phake',

  // Scam / catfish
  'catfish',
  'scam',

  // Proof request
  'video call',
  'voice call',
  'show me you are real',
  'send me a video',
  'verify',

  // Report
  'report you',
  'report this',
  'police',

  // Vietnamese
  'lừa đảo',
  'giả vong',
  'không thật',
];

// Keywords check riêng (single word, cần word boundary)
const SINGLE_WORD_KEYWORDS = ['ai', 'bot', 'fake', 'real'];

// ================== HELPERS ==================

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Kiểm tra text có chứa keyword không
export function checkKeywords(text) {
  const textLower = text.toLowerCase();
  const detected = [];

  // Check phrases trước (dài hơn, precise hơn)
  for (const keyword of INTERVENTION_KEYWORDS) {
    if (textLower.includes(keyword.toLowerCase())) {
      detected.push(keyword);
    }
  }

  // Nếu chưa detect được gì, check single words với word boundary
  if (detected.length === 0) {
    for (const word of SINGLE_WORD_KEYWORDS) {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(textLower)) {
        detected.push(word);
      }
    }
  }

  return detected;
}

// ================== TELEGRAM API CALLS ==================

async function sendTelegramMessage(chatId, text, messageThreadId = null) {
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };

  if (messageThreadId) {
    body.message_thread_id = messageThreadId;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
    return await res.json();
  } catch (e) {
    console.error('❌ sendTelegramMessage error:', e.message);
    return null;
  }
}

async function createForumTopic(groupId, topicName) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: groupId,
          name: topicName
        })
      }
    );
    const data = await res.json();

    if (data.ok) {
      return data.result.message_thread_id;
    } else {
      console.error('❌ createForumTopic failed:', JSON.stringify(data));
      return null;
    }
  } catch (e) {
    console.error('❌ createForumTopic error:', e.message);
    return null;
  }
}

// ================== CORE FUNCTIONS ==================

// Tạo hoặc lấy topic cho user
async function getOrCreateTopic(userId, username, firstName) {
  let topicId = getTopicId(userId);
  if (topicId) return topicId;

  // Tạo topic mới
  const displayName = username ? `@${username}` : (firstName || 'User');
  const topicName = `${displayName} (${userId})`;

  topicId = await createForumTopic(FORUM_GROUP_ID, topicName);
  if (!topicId) {
    console.error('❌ Failed to create topic for user', userId);
    return null;
  }

  // Lưu vào DB
  saveTopicId(userId, topicId, username, firstName);

  // Gửi thông báo user mới vào topic
  const vnTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  await sendTelegramMessage(
    FORUM_GROUP_ID,
    `🆕 <b>USER MỚI</b>\n` +
    `👤 Tên: ${firstName || 'Unknown'}\n` +
    `🆔 ID: <code>${userId}</code>\n` +
    `📱 Username: ${username ? '@' + username : 'không có'}\n` +
    `⏰ ${vnTime}`,
    topicId
  );

  console.log(`✅ Created topic ${topicId} for user ${userId}`);
  return topicId;
}

// ================== MAIN EXPORTS ==================

/**
 * Log tin nhắn của user vào topic.
 * Nếu phát hiện keyword → alert admin, đánh dấu waiting_admin = true.
 * @returns { logged, needsIntervention, keywords }
 */
export async function logUserMessage(userId, username, firstName, messageText) {
  if (!FORUM_GROUP_ID) {
    console.log('⚠️  FORUM_GROUP_ID not set - skipping monitoring');
    return { logged: false, needsIntervention: false, keywords: [] };
  }

  const topicId = await getOrCreateTopic(userId, username, firstName);
  if (!topicId) {
    return { logged: false, needsIntervention: false, keywords: [] };
  }

  const detectedKeywords = checkKeywords(messageText);
  const needsIntervention = detectedKeywords.length > 0;
  const alreadyWaiting = isWaitingAdmin(userId);
  const vnTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  // --- CÓ KEYWORD hoặc đang chờ admin ---
  if (needsIntervention || alreadyWaiting) {
    setWaitingAdmin(userId, true);

    let alertMsg = `🚨 <b>CẦN CAN THIỆP!</b>\n\n`;
    alertMsg += `👤 <b>USER:</b> <i>${escapeHtml(messageText)}</i>\n`;
    alertMsg += `⏰ ${vnTime}\n\n`;

    if (needsIntervention) {
      alertMsg += `⚠️ <b>Keywords:</b> ${detectedKeywords.map(k => `<code>${k}</code>`).join(', ')}\n\n`;
    }
    if (alreadyWaiting && !needsIntervention) {
      alertMsg += `⏸️ Đang ở chế độ chờ admin\n\n`;
    }
    alertMsg += `⏸️ <b>Bot ĐÃ DỪNG tự reply</b>\n`;
    alertMsg += `👉 Gõ tin nhắm trong topic này để reply cho user`;

    await sendTelegramMessage(FORUM_GROUP_ID, alertMsg, topicId);

    // Gửi DM riêng cho admin (chỉ nếu cách alert trước > 5 phút)
    const lastAlert = getLastAlertTime(userId);
    const now = Date.now();
    const fiveMin = 5 * 60 * 1000;

    if (!lastAlert || (now - new Date(lastAlert).getTime()) > fiveMin) {
      for (const adminId of ADMIN_IDS) {
        await sendTelegramMessage(
          adminId,
          `🚨 <b>Cần can thiệp!</b>\n` +
          `👤 ${username ? '@' + username : firstName || 'User'} (<code>${userId}</code>)\n` +
          `💬 "${escapeHtml(messageText.substring(0, 100))}"\n` +
          `⚠️ Keywords: ${detectedKeywords.join(', ')}`
        );
      }
      updateLastAlertTime(userId);
    }

    console.log(`🚨 INTERVENTION for user ${userId} | keywords: [${detectedKeywords.join(', ')}]`);
    return { logged: true, needsIntervention: true, keywords: detectedKeywords };
  }

  // --- TIN NHẮN BÌNH THƯỜNG ---
  await sendTelegramMessage(
    FORUM_GROUP_ID,
    `👤 <b>USER:</b> <i>${escapeHtml(messageText)}</i>\n⏰ ${vnTime}`,
    topicId
  );

  return { logged: true, needsIntervention: false, keywords: [] };
}

/**
 * Log tin nhắn của bot vào topic (để theo dõi).
 */
export async function logBotMessage(userId, messageText) {
  if (!FORUM_GROUP_ID) return;

  const topicId = getTopicId(userId);
  if (!topicId) return;

  const vnTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  await sendTelegramMessage(
    FORUM_GROUP_ID,
    `🤖 <b>BOT:</b> <i>${escapeHtml(messageText)}</i>\n⏰ ${vnTime}`,
    topicId
  );
}

/**
 * Xử lý tin nhắn từ admin trong topic.
 * Nếu admin gõ tin nhắm thường → gửi cho user.
 * Nếu admin gõ /auto → bật lại chế độ auto cho user.
 * @returns { sent, userId } hoặc null nếu không phải admin action
 */
export async function handleAdminMessage(message) {
  const chatId = message.chat?.id;
  const fromId = message.from?.id;
  const topicId = message.message_thread_id;
  const text = message.text;

  // Chỉ xử lý trong forum group
  if (chatId !== FORUM_GROUP_ID) return null;

  // Chỉ admin
  if (!ADMIN_IDS.includes(fromId)) return null;

  // Phải có topic
  if (!topicId) return null;

  // Tìm user từ topic
  const targetUserId = getUserIdByTopicId(topicId);
  if (!targetUserId) return null;

  // ── Command /auto ──
  if (text && text.trim() === '/auto') {
    setWaitingAdmin(targetUserId, false);
    await sendTelegramMessage(
      FORUM_GROUP_ID,
      '✅ <b>Đã bật AUTO</b> cho user này. Bot sẽ tự reply lại.',
      topicId
    );
    console.log(`✅ Admin set AUTO for user ${targetUserId}`);
    return { command: 'auto', userId: targetUserId };
  }

  // ── Bỏ qua nếu không có text ──
  if (!text) return null;

  // ── Gửi tin nhắn của admin cho user ──
  const sent = await sendTelegramMessage(targetUserId, text);

  if (sent && sent.ok) {
    // Confirm trong topic
    await sendTelegramMessage(FORUM_GROUP_ID, '✅ Đã gửi cho user', topicId);

    // Log vào topic
    const vnTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    await sendTelegramMessage(
      FORUM_GROUP_ID,
      `🤖 <b>BOT (Admin):</b> <i>${escapeHtml(text)}</i>\n⏰ ${vnTime}`,
      topicId
    );

    // Tắt chế độ chờ → bot tự reply lại
    setWaitingAdmin(targetUserId, false);
    await sendTelegramMessage(FORUM_GROUP_ID, '✅ Bot đã chuyển về chế độ <b>AUTO</b>', topicId);

    console.log(`👨‍💼 Admin replied to user ${targetUserId}`);
    return { sent: true, userId: targetUserId };
  } else {
    await sendTelegramMessage(FORUM_GROUP_ID, '❌ Lỗi khi gửi tin nhắn cho user', topicId);
    return null;
  }
}

// Re-export isWaitingAdmin cho app.js dùng
export { isWaitingAdmin } from './monitoringDb.js';  // ✅ bỏ "user_monitoring/"
