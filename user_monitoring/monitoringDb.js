import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'monitoring_data.json');

// ================== Load / Save JSON ==================
function loadData() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('⚠️  Error loading monitoring data:', e.message);
  }
  return { users: {} };
}

function saveData(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('⚠️  Error saving monitoring data:', e.message);
  }
}

// ================== EXPORTS ==================

// Lấy topic_id của user
export function getTopicId(userId) {
  const data = loadData();
  const user = data.users[userId];
  return user ? user.topic_id : null;
}

// Lưu topic_id mới cho user
export function saveTopicId(userId, topicId, username, firstName) {
  const data = loadData();
  data.users[userId] = {
    topic_id: topicId,
    username: username || null,
    first_name: firstName || null,
    created_at: new Date().toISOString(),
    waiting_admin: false,
    last_alert_time: null
  };
  saveData(data);
}

// Đánh dấu user đang chờ admin trả lời
export function setWaitingAdmin(userId, waiting) {
  const data = loadData();
  if (data.users[userId]) {
    data.users[userId].waiting_admin = waiting;
    saveData(data);
  }
}

// Kiểm tra user có đang chờ admin không
export function isWaitingAdmin(userId) {
  const data = loadData();
  const user = data.users[userId];
  return user ? user.waiting_admin === true : false;
}

// Lấy user_id từ topic_id (để admin reply)
export function getUserIdByTopicId(topicId) {
  const data = loadData();
  for (const [userId, user] of Object.entries(data.users)) {
    if (user.topic_id === topicId) {
      return userId;
    }
  }
  return null;
}

// Cập nhật thời gian alert cuối (để tránh spam notification cho admin)
export function updateLastAlertTime(userId) {
  const data = loadData();
  if (data.users[userId]) {
    data.users[userId].last_alert_time = new Date().toISOString();
    saveData(data);
  }
}

// Lấy thời gian alert cuối
export function getLastAlertTime(userId) {
  const data = loadData();
  const user = data.users[userId];
  return user ? user.last_alert_time : null;
}
