const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');

/**
 * Send photo to Telegram
 * Hỗ trợ 2 mode:
 *   - file_id (Supabase schema mới): gửi qua JSON
 *   - photoPath (legacy): gửi qua multipart/form-data
 */
async function sendPhoto(chatId, photoSource, options = {}) {
  const {
    spoiler = false,
    autoDelete = false,
    ttl = null,
    caption = null,
    isFileId = false  // true nếu photoSource là Telegram file_id
  } = options;

  const token = process.env.TELEGRAM_AURELIABOT_TOKEN;

  try {
    let response;

    if (isFileId) {
      // ✅ Supabase schema mới — gửi bằng file_id qua JSON
      const body = { chat_id: chatId, photo: photoSource };
      if (spoiler) body.has_spoiler = true;
      if (caption) body.caption = caption;

      response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      // 🔁 Legacy — gửi bằng file path qua multipart
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('photo', fs.createReadStream(photoSource));
      if (spoiler) form.append('has_spoiler', 'true');
      if (caption) form.append('caption', caption);

      response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: form,
      });
    }

    const data = await response.json();

    // Handle auto-delete with TTL — telegramAssets tự xử lý, không cần duplicate ở app.js
    if (autoDelete && ttl && data.ok) {
      const messageId = data.result.message_id;
      setTimeout(async () => {
        await deleteMessage(chatId, messageId);
      }, ttl * 1000);
    }

    return data;
  } catch (error) {
    console.error('Error sending photo:', error);
    return null;
  }
}

/**
 * Send video to Telegram
 * Hỗ trợ 2 mode: file_id (mới) và videoPath (legacy)
 */
async function sendVideo(chatId, videoSource, options = {}) {
  const {
    spoiler = false,
    autoDelete = false,
    ttl = null,
    caption = null,
    isFileId = false
  } = options;

  const token = process.env.TELEGRAM_AURELIABOT_TOKEN;

  try {
    let response;

    if (isFileId) {
      // ✅ Supabase schema mới — gửi bằng file_id qua JSON
      const body = { chat_id: chatId, video: videoSource };
      if (spoiler) body.has_spoiler = true;
      if (caption) body.caption = caption;

      response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      // 🔁 Legacy — gửi bằng file path qua multipart
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('video', fs.createReadStream(videoSource));
      if (spoiler) form.append('has_spoiler', 'true');
      if (caption) form.append('caption', caption);

      response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        body: form,
      });
    }

    const data = await response.json();

    // Handle auto-delete
    if (autoDelete && ttl && data.ok) {
      const messageId = data.result.message_id;
      setTimeout(async () => {
        await deleteMessage(chatId, messageId);
      }, ttl * 1000);
    }

    return data;
  } catch (error) {
    console.error('Error sending video:', error);
    return null;
  }
}

/**
 * Delete a message
 */
async function deleteMessage(chatId, messageId) {
  const token = process.env.TELEGRAM_AURELIABOT_TOKEN;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
    const data = await res.json();
    if (data.ok) console.log(`🗑️ Auto-deleted message ${messageId} for ${chatId}`);
    else console.warn(`⚠️ Delete failed for message ${messageId}: ${data.description}`);
  } catch (error) {
    console.error('Error deleting message:', error);
  }
}

/**
 * Send asset based on asset data
 * Hỗ trợ cả 2 schema:
 *   - Schema mới (Supabase): asset.file_id + asset.media_type
 *   - Schema cũ (legacy):    asset.path
 */
async function sendAsset(chatId, asset) {
  if (!asset) return null;

  // ── Phân biệt schema mới vs legacy ──
  const hasFileId = !!asset.file_id;
  const mediaType = asset.media_type || 'photo'; // 'photo' | 'video' | 'document'

  // Determine if should use spoiler
  // Không spoiler cho: meme, gift, gift_image, confirmation, post_support_confirmation
  const noSpoilerTypes = ['meme', 'gift', 'gift_image', 'confirmation', 'post_support_confirmation'];
  const shouldSpoiler = !noSpoilerTypes.includes(asset.type);

  const options = {
    spoiler: shouldSpoiler,
    autoDelete: asset.auto_delete || false,
    ttl: asset.ttl || null,
    caption: null,
    isFileId: hasFileId,
  };

  if (hasFileId) {
    // ✅ Supabase schema mới — dùng file_id
    const isVideo = mediaType === 'video';
    if (isVideo) {
      return await sendVideo(chatId, asset.file_id, options);
    } else {
      return await sendPhoto(chatId, asset.file_id, options);
    }
  } else if (asset.path) {
    // 🔁 Legacy — dùng file path
    const isVideo = asset.path.endsWith('.mp4') || asset.path.endsWith('.mov');
    if (isVideo) {
      return await sendVideo(chatId, asset.path, options);
    } else {
      return await sendPhoto(chatId, asset.path, options);
    }
  } else {
    console.warn(`⚠️ sendAsset: asset ${asset.assetId} has neither file_id nor path`);
    return null;
  }
}

/**
 * Send typing indicator
 */
async function sendTyping(chatId) {
  const token = process.env.TELEGRAM_AURELIABOT_TOKEN;

  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });
}

/**
 * Send upload photo indicator (for when sending photos)
 */
async function sendUploadPhoto(chatId) {
  const token = process.env.TELEGRAM_AURELIABOT_TOKEN;

  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'upload_photo' }),
  });
}

module.exports = {
  sendPhoto,
  sendVideo,
  sendAsset,
  sendTyping,
  sendUploadPhoto,
  deleteMessage
};
