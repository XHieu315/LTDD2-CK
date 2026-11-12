/**
 * Script Test Nhanh Luồng Cảnh Báo Không Cần Mở Wokwi / Postman
 * Chạy lệnh: node test-alert.js
 */

const http = require('http');

require('dotenv').config();

const SERVER_HOST = 'localhost';
const SERVER_PORT = process.env.PORT || 5000;

function sendTestAlert(alertType, message, value, sensor) {
  const payload = JSON.stringify({
    alertType,
    message,
    value,
    sensor,
    location: 'Phòng Thí Nghiệm (Test Script)'
  });

  const options = {
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: '/api/iot/alert',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => { responseData += chunk; });
    res.on('end', () => {
      console.log(`\n📡 [Gửi ${alertType}] Status: ${res.statusCode}`);
      console.log(`📦 Kết quả: ${responseData}`);
    });
  });

  req.on('error', (e) => {
    console.error(`❌ Không thể kết nối tới Server Node.js tại http://${SERVER_HOST}:${SERVER_PORT}`);
    console.error(`👉 Hãy đảm bảo bạn đã chạy server trước bằng lệnh: cd backend-server && npm start`);
  });

  req.write(payload);
  req.end();
}

console.log('====================================================');
console.log('🚀 ĐANG BẮN DỮ LIỆU CẢNH BÁO GIẢ LẬP TỚI SERVER...');
console.log('====================================================');

// Gửi lần lượt các loại cảnh báo
setTimeout(() => sendTestAlert('PHÁT HIỆN CHÁY', 'Ngọn lửa bùng phát tại khu vực bếp!', 1.0, 'Flame Sensor'), 500);
setTimeout(() => sendTestAlert('RÒ RỈ KHÍ GAS', 'Nồng độ khí gas nguy hiểm: 2800 ppm!', 2800, 'MQ-2 Gas'), 2000);
setTimeout(() => sendTestAlert('PHÁT HIỆN XÂM NHẬP', 'Phát hiện có người đột nhập vào ban đêm!', 1.0, 'PIR Motion'), 3500);
setTimeout(() => sendTestAlert('NHIỆT ĐỘ QUÁ CAO', 'Nhiệt độ phòng tăng vọt lên 54.2°C!', 54.2, 'DHT22'), 5000);

