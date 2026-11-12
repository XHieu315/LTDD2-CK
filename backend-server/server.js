const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const IOT_TOPIC = process.env.IOT_TOPIC || 'iot_alerts';

// ---------------------------------------------------------------------------
// 1. Khởi tạo Firebase Admin SDK
// ---------------------------------------------------------------------------
let admin = null;
let fcmAvailable = false;

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(serviceAccountPath)) {
  try {
    admin = require('firebase-admin');
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    fcmAvailable = true;
    console.log('✅ Firebase Admin SDK khởi tạo thành công.');
  } catch (err) {
    console.error('❌ Lỗi nạp serviceAccountKey.json:', err.message);
  }
} else {
  console.warn('⚠️ CẢNH BÁO: Chưa tìm thấy file serviceAccountKey.json trong thư mục backend-server!');
  console.warn('👉 Hãy tải file từ Firebase Console -> Project Settings -> Service accounts và đặt vào thư mục này.');
}

// ---------------------------------------------------------------------------
// 2. Bộ nhớ lưu trữ tạm & Hàm gửi Push Notification
// ---------------------------------------------------------------------------
const alertHistory = [];
const TOKENS_FILE = path.join(__dirname, 'registered_tokens.json');
const registeredTokens = new Set();

// Nạp các Token đã lưu từ trước (để server khởi động lại không bị mất token iPhone)
if (fs.existsSync(TOKENS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    if (Array.isArray(saved)) {
      saved.forEach(t => registeredTokens.add(t));
      console.log(`📱 Đã nạp ${registeredTokens.size} Device Token từ file lưu trữ.`);
    }
  } catch (e) {
    console.warn('Lỗi nạp registered_tokens.json:', e.message);
  }
}

function saveRegisteredTokens() {
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(Array.from(registeredTokens), null, 2), 'utf8');
  } catch (e) {
    console.warn('Lỗi ghi registered_tokens.json:', e.message);
  }
}

// Hàm hỗ trợ gửi Push Notification (Hỗ trợ cả Expo Push Token và FCM Token)
async function sendPushToToken(token, title, body, data = {}) {
  // 1. Nếu là Expo Push Token (chạy Expo Go trên iOS/Android)
  if (token && token.startsWith('ExponentPushToken')) {
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: token,
          sound: 'default',
          title: title,
          body: body,
          data: data,
          priority: 'high',
          channelId: 'iot_emergency_channel',
        }),
      });
      const json = await res.json();
      console.log('📱 [Expo Push Sent]:', json);
      return { type: 'expo', result: json };
    } catch (e) {
      console.error('❌ Lỗi gửi Expo Push:', e.message);
      return { type: 'expo', error: e.message };
    }
  }

  // 2. Nếu là FCM Registration Token thuần từ Firebase
  if (fcmAvailable && admin) {
    try {
      const res = await admin.messaging().send({
        token: token,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        android: {
          priority: 'high',
          notification: {
            channelId: 'iot_emergency_channel',
            sound: 'default',
            priority: 'max',
          }
        }
      });
      console.log('🔥 [FCM Token Sent]:', res);
      return { type: 'fcm', result: res };
    } catch (e) {
      console.error('❌ Lỗi gửi FCM Token:', e.message);
      return { type: 'fcm', error: e.message };
    }
  }

  return { type: 'mock', message: 'Token được ghi nhận ở Console' };
}

// Hàm dùng chung để xử lý và phân phối cảnh báo (gọi từ MQTT hoặc HTTP POST)
async function handleIncomingAlert({ alertType, message, value, location, sensor }) {
  const timestamp = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const alertRecord = {
    id: Date.now().toString(),
    alertType: String(alertType).toUpperCase(),
    message,
    value: value !== undefined ? value : null,
    location: location || 'Hệ thống Smart Home',
    sensor: sensor || 'Cảm biến IoT',
    timestamp
  };

  // Lưu vào lịch sử (giới hạn 50 bản ghi)
  alertHistory.unshift(alertRecord);
  if (alertHistory.length > 50) alertHistory.pop();

  console.log(`\n🚨 [CẢNH BÁO IOT XỬ LÝ - ${timestamp}]`);
  console.log(`Loại: ${alertRecord.alertType} | Giá trị: ${alertRecord.value}`);
  console.log(`Tin nhắn: ${alertRecord.message}`);

  // 1. Gửi Push tới tất cả Device Token đã kết nối
  const tokenPushResults = [];
  for (const token of registeredTokens) {
    const pushRes = await sendPushToToken(
      token,
      `⚠️ CẢNH BÁO: ${alertRecord.alertType}`,
      `${alertRecord.message} (Chỉ số: ${alertRecord.value ?? 'N/A'})`,
      alertRecord
    );
    tokenPushResults.push(pushRes);
  }

  // 2. Gửi thêm vào Topic Firebase Admin (nếu đã cấu hình)
  let fcmTopicResult = null;
  if (fcmAvailable && admin) {
    try {
      const payload = {
        topic: IOT_TOPIC,
        notification: {
          title: `⚠️ CẢNH BÁO KHẨN: ${alertRecord.alertType}`,
          body: `${alertRecord.message} (Chỉ số: ${alertRecord.value ?? 'N/A'})`
        },
        data: Object.fromEntries(Object.entries(alertRecord).map(([k, v]) => [k, String(v ?? '')])),
        android: {
          priority: 'high',
          notification: {
            channelId: 'iot_emergency_channel',
            sound: 'default',
            priority: 'max',
            color: '#FF0000',
            defaultVibrateTimings: true
          }
        }
      };
      fcmTopicResult = await admin.messaging().send(payload);
      console.log('📡 Đã gửi Push Notification tới topic:', IOT_TOPIC, '| MessageId:', fcmTopicResult);
    } catch (fcmErr) {
      console.error('❌ Lỗi FCM Topic:', fcmErr.message);
    }
  }

  return {
    success: true,
    messageId: fcmTopicResult || (tokenPushResults.length > 0 ? 'tokens_sent' : 'logged'),
    sentToTokens: tokenPushResults.length,
    data: alertRecord
  };
}

// ---------------------------------------------------------------------------
// 3. Tích hợp EMQX Cloud Broker qua MQTTS (Port 8883)
// ---------------------------------------------------------------------------
const MQTT_HOST = process.env.MQTT_HOST || 'f122f61f.ala.asia-southeast1.emqxsl.com';
const MQTT_PORT = process.env.MQTT_PORT || 8883;
const MQTT_PROTOCOL = process.env.MQTT_PROTOCOL || 'mqtts';
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'hieu';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';
const rawAlerts = process.env.MQTT_TOPIC_ALERTS || 'smarthome/alert/#';
const MQTT_TOPIC_ALERTS = rawAlerts.endsWith('/') ? `${rawAlerts}#` : (rawAlerts.includes('#') ? rawAlerts : `${rawAlerts}/#`);
const MQTT_TOPIC_TELEMETRY = process.env.MQTT_TOPIC_TELEMETRY || 'smarthome/telemetry';

let mqttClient = null;

if (MQTT_HOST) {
  const brokerUrl = `${MQTT_PROTOCOL}://${MQTT_HOST}:${MQTT_PORT}`;
  console.log(`🔌 Đang kết nối tới EMQX Cloud Broker: ${brokerUrl}...`);

  mqttClient = mqtt.connect(brokerUrl, {
    clientId: `server_nodejs_${Math.random().toString(16).substring(2, 8)}`,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    rejectUnauthorized: false, // Bỏ qua kiểm tra CA cục bộ để hỗ trợ TLS mượt mà
    reconnectPeriod: 5000,
  });

  mqttClient.on('connect', () => {
    console.log('✅ Đã kết nối thành công tới EMQX Cloud Broker (Port 8883)!');
    mqttClient.subscribe([MQTT_TOPIC_ALERTS, MQTT_TOPIC_TELEMETRY], (err) => {
      if (!err) {
        console.log(`📡 Đã Subscribe các topics: ["${MQTT_TOPIC_ALERTS}", "${MQTT_TOPIC_TELEMETRY}"]`);
      } else {
        console.error('❌ Lỗi khi subscribe topic MQTT:', err.message);
      }
    });
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const payloadStr = message.toString();
      console.log(`\n📨 [MQTT NHẬN ĐƯỢC TỪ EMQX] Topic: ${topic}`);
      console.log(`📦 Payload: ${payloadStr}`);

      let data = {};
      try {
        data = JSON.parse(payloadStr);
      } catch {
        data = { raw: payloadStr };
      }

      // Xử lý khi nhận topic cảnh báo: smarthome/alert/fire, smarthome/alert/gas, v.v...
      if (topic.startsWith('smarthome/alert')) {
        const subType = topic.split('/').pop().toUpperCase();
        const alertType = data.alert || data.alertType || subType;
        const alertMsg = data.msg || data.message || `Cảnh báo ${alertType} phát hiện từ hệ thống!`;
        const alertVal = data.val !== undefined ? data.val : (data.value !== undefined ? data.value : null);

        await handleIncomingAlert({
          alertType,
          message: alertMsg,
          value: alertVal,
          location: data.location || 'Khu vực Cảm Biến (EMQX)',
          sensor: data.sensor || `Cảm biến MQTT (${subType})`
        });
      }
      // Xử lý khi nhận telemetry định kỳ: smarthome/telemetry
      else if (topic === MQTT_TOPIC_TELEMETRY) {
        console.log(`🌡️ [Telemetry Data]: Temp=${data.temp}°C, Hum=${data.hum}%, Gas=${data.gas}`);
      }
    } catch (err) {
      console.error('❌ Lỗi phân tích message MQTT:', err.message);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('⚠️ [MQTT Error]:', err.message);
  });

  mqttClient.on('reconnect', () => {
    console.log('🔄 Đang thử kết nối lại EMQX Cloud Broker...');
  });
}

// ---------------------------------------------------------------------------
// 4. Định nghĩa các Endpoints HTTP Express
// ---------------------------------------------------------------------------

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    name: 'IoT Notification Backend Server (LAB 2 + EMQX)',
    fcmReady: fcmAvailable,
    emqxConnected: mqttClient ? mqttClient.connected : false,
    broker: `${MQTT_PROTOCOL}://${MQTT_HOST}:${MQTT_PORT}`,
    timestamp: new Date().toISOString()
  });
});

// Lấy lịch sử cảnh báo
app.get('/api/iot/history', (req, res) => {
  res.json({
    total: alertHistory.length,
    registeredDevices: registeredTokens.size,
    data: alertHistory
  });
});

// Đăng ký token từ App di động
app.post('/api/register-token', (req, res) => {
  const { token, device } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: 'Thiếu token' });
  }
  registeredTokens.add(token);
  saveRegisteredTokens();
  console.log(`📱 [Đã lưu Device Token]: ${token.substring(0, 30)}... (${device || 'Mobile App'})`);
  return res.json({ success: true, totalTokens: registeredTokens.size });
});

// Endpoint HTTP POST (Dùng khi test Postman hoặc Wokwi HTTP)
app.post('/api/iot/alert', async (req, res) => {
  try {
    const { alertType, message, value, location, sensor } = req.body;
    if (!alertType || !message) {
      return res.status(400).json({ success: false, error: 'Thiếu alertType hoặc message' });
    }

    const result = await handleIncomingAlert({ alertType, message, value, location, sensor });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint test gửi thông báo trực tiếp vào Token
app.post('/api/notify-token', async (req, res) => {
  try {
    const { token, title, body, data } = req.body;
    if (!token || !title || !body) {
      return res.status(400).json({ success: false, error: 'Thiếu token, title hoặc body' });
    }

    const pushResult = await sendPushToToken(token, title, body, data || {});
    return res.json({ success: true, pushResult });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint điều khiển ngược lại qua MQTT (Ví dụ: tắt còi buzzer từ xa)
app.post('/api/control', (req, res) => {
  const { command, device } = req.body;
  const topic = `smarthome/control/${device || 'buzzer'}`;
  const payload = JSON.stringify({ command: command || 'OFF', timestamp: Date.now() });

  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(topic, payload, (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      console.log(`📢 [Lệnh Điều Khiển Đã Gửi Tới MQTT]: ${topic} -> ${payload}`);
      return res.json({ success: true, topic, command });
    });
  } else {
    return res.status(503).json({ success: false, error: 'MQTT Broker chưa kết nối' });
  }
});

// ---------------------------------------------------------------------------
// 5. Khởi chạy Server (Hỗ trợ cả Localhost và Vercel Serverless)
// ---------------------------------------------------------------------------
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🌐 Server LAB 2 đang chạy tại: http://localhost:${PORT}`);
    console.log(`☁️ EMQX Host: ${MQTT_HOST}:${MQTT_PORT} (TLS/SSL)`);
    console.log(`📡 Topic Cảnh báo: "${MQTT_TOPIC_ALERTS}"`);
    console.log(`====================================================`);
  });
}

module.exports = app;
