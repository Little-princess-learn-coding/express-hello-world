const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');

/**
 * Send photo to Telegram
 */
async function sendPhoto(chatId, photoPath, options = {}) {
  const {
    spoiler = false,
    autoDelete = false,
    ttl = null,
    caption = null
  } = options;

  const token = process.env.TELEGRAM_AURELIABOT_TOKEN;
  
  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', fs.createReadStream(photoPath));
    
    if (spoiler) {
      form.append('has_spoiler', 'true');
    }
    
    if (caption) {
      form.append('caption', caption);
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendPhoto`,
      {
        method: 'POST',
        body: form
      }
    );

    const data = await response.json();
    
    // Handle auto-delete with TTL
    if (autoDelete && ttl && data.ok) {
      const messageId = data.result.message_id;
      setTimeout(async () => {
        await deleteMessage(chatId, messageId);
      }, ttl * 1000); // Convert seconds to milliseconds
    }

    return data;
  } catch (error) {
    console.error('Error sending photo:', error);
    return null;
  }
}

/**
 * Send video to Telegram
 */
async function sendVideo(chatId, videoPath, options = {}) {
  const {
    spoiler = false,
    autoDelete = false,
    ttl = null,
    caption = null
  } = options;

  const token = process.env.TELEGRAM_AURELIABOT_TOKEN;
  
  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('video', fs.createReadStream(videoPath));
    
    if (spoiler) {
      form.append('has_spoiler', 'true');
    }
    
    if (caption) {
      form.append('caption', caption);
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendVideo`,
      {
        method: 'POST',
        body: form
      }
    );

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
    await fetch(
      `https://api.telegram.org/bot${token}/deleteMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId
        })
      }
    );
  } catch (error) {
    console.error('Error deleting message:', error);
  }
}

/**
 * Send asset based on asset data
 */
async function sendAsset(chatId, asset) {
  if (!asset) return null;

  const isVideo = asset.path.endsWith('.mp4') || asset.path.endsWith('.mov');
  
  // Determine if should use spoiler
  // Schema says: spoiler for all EXCEPT memes, gift_image, post_support_confirmation
  const shouldSpoiler = ![
    'meme', 
    'gift_image', 
    'post_support_confirmation'
  ].includes(asset.type);

  const options = {
    spoiler: shouldSpoiler,
    autoDelete: asset.auto_delete || false,
    ttl: asset.ttl || null,
    caption: null
  };

  if (isVideo) {
    return await sendVideo(chatId, asset.path, options);
  } else {
    return await sendPhoto(chatId, asset.path, options);
  }
}

/**
 * Send typing indicator
 */
async function sendTyping(chatId) {
  const token = process.env.TELEGRAM_AURELIABOT_TOKEN;
  
  await fetch(
    `https://api.telegram.org/bot${token}/sendChatAction`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action: 'typing'
      })
    }
  );
}

/**
 * Send upload photo indicator (for when sending photos)
 */
async function sendUploadPhoto(chatId) {
  const token = process.env.TELEGRAM_AURELIABOT_TOKEN;
  
  await fetch(
    `https://api.telegram.org/bot${token}/sendChatAction`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action: 'upload_photo'
      })
    }
  );
}

module.exports = {
  sendPhoto,
  sendVideo,
  sendAsset,
  sendTyping,
  sendUploadPhoto,
  deleteMessage
};
