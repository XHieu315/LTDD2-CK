/**
 * Script Test Kết Nối và Bắn Thông Điệp Thử Nghiệm qua EMQX Cloud (Port 8883)
 * Chạy lệnh: node test-mqtt.js
 */

const mqtt = require('mqtt');
require('dotenv').config();

const MQTT_HOST = process.env.MQTT_HOST || 'f122f61f.ala.asia-southeast1.emqxsl.com';
const MQTT_PORT = process.env.MQTT_PORT || 8883;
const MQTT_PROTOCOL = process.env.MQTT_PROTOCOL || 'mqtts';
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'hieu';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';

const brokerUrl = `${MQTT_PROTOCOL}://${MQTT_HOST}:${MQTT_PORT}`;
console.log(`🔌 Đang kết nối thử tới EMQX: ${brokerUrl}...`);

const client = mqtt.connect(brokerUrl, {
  clientId: `test_tester_${Math.random().toString(16).substring(2, 8)}`,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  rejectUnauthorized: false,
});

client.on('connect', () => {
  console.log('✅ Kết nối thành công tới EMQX Cloud Broker!');
  console.log('🚀 Đang bắn thông điệp cảnh báo test lên topic: smarthome/alert/fire...');

  const payload = JSON.stringify({
    alert: 'PHÁT HIỆN CHÁY (TEST MQTTX/EMQX)',
    msg: 'Thử nghiệm bắn tin qua EMQX Cloud Port 8883!',
    val: 1,
    location: 'Phòng Thí Nghiệm (Test Script)',
    timestamp: Date.now()
  });

  client.publish('smarthome/alert/fire', payload, () => {
    console.log('📡 Đã publish thành công:', payload);
    console.log('👉 Hãy kiểm tra giao diện MQTTX và Server Node.js để thấy kết quả!');
    setTimeout(() => {
      client.end();
      process.exit(0);
    }, 1000);
  });
});

client.on('error', (err) => {
  console.error('❌ Lỗi kết nối MQTT:', err.message);
  process.exit(1);
});

