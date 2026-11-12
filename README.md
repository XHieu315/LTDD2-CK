# ĐỒ ÁN CUỐI KỲ: HỆ THỐNG CẢNH BÁO IOT & THÔNG BÁO ĐẨY FIREBASE (FCM)

Hệ thống tích hợp trọn vẹn 3 Lab theo đúng yêu cầu:
* **LAB 1:** App Di Động React Native nhận thông báo đẩy qua Firebase Cloud Messaging.
* **LAB 2:** Server NodeJS (Express + Firebase Admin SDK) tiếp nhận API và gửi Push Notification.
* **LAB 3:** Hệ thống IoT vi điều khiển ESP32 mô phỏng trên nền tảng **Wokwi**, đọc các cảm biến (Nhiệt độ cao/thấp, Cháy, Khí Gas rò rỉ, Người lạ xâm nhập) và kích hoạt API cảnh báo.

---

## 📁 Cấu Trúc Thư Mục
```text
CK-LTDD2/
├── backend-server/             # LAB 2: Server Node.js
│   ├── server.js               # Mã nguồn chính API và Firebase Admin SDK
│   ├── test-alert.js           # Tool gửi thử cảnh báo không cần Wokwi
│   ├── package.json
│   ├── serviceAccountKey.json  # File cấu hình lấy từ Firebase Console
│   └── README.md
│
├── mobile-app/                 # LAB 1: App React Native
│   ├── App.js                  # Giao diện nhận thông báo, token, lịch sử
│   ├── app.json                # Cấu hình Expo, FCM Channel, Google Services
│   ├── package.json
│   └── README.md
│
├── iot-esp32-wokwi/            # LAB 3: Mô phỏng ESP32 trên Wokwi
│   ├── sketch.ino              # Mã nguồn Arduino C++ nạp cho ESP32
│   ├── diagram.json            # Sơ đồ mạch điện tử các cảm biến trên Wokwi
│   ├── libraries.txt           # Danh sách thư viện Wokwi
│   └── README.md
│
└── README.md                   # Hướng dẫn tổng quan
```

---

## ⚡ Hướng Dẫn Chạy & Kiểm Thử Từng Phần

### Bước 1: Khởi động Server Backend (LAB 2)
1. Mở Terminal:
   ```bash
   cd backend-server
   npm install
   npm start
   ```
2. Server sẽ chạy tại cổng `http://localhost:3000`.

### Bước 2: Khởi động App Mobile React Native (LAB 1)
1. Mở một cửa sổ Terminal mới:
   ```bash
   cd mobile-app
   npm install
   npx expo start
   ```
2. Dùng điện thoại mở ứng dụng **Expo Go** quét mã QR để mở app.
3. App hiển thị mã **Push Token** trên màn hình.

### Bước 3: Chạy Mô Phỏng Cảm Biến ESP32 trên Wokwi (LAB 3)
1. Truy cập [Wokwi ESP32](https://wokwi.com/projects/new/esp32).
2. Copy nội dung file `iot-esp32-wokwi/sketch.ino` vào tab `sketch.ino`.
3. Copy nội dung file `iot-esp32-wokwi/diagram.json` vào tab `diagram.json`.
4. Trong `sketch.ino`, sửa `SERVER_URL` trỏ về server Node.js của bạn (dùng domain đã deploy hoặc URL ngrok).
5. Nhấn **Play**:
   * Kéo nhiệt độ DHT22 > 45°C $\rightarrow$ Bắn cảnh báo Quá nhiệt.
   * Bấm nút Cháy $\rightarrow$ Báo động Cháy.
   * Xoay biến trở Gas $\rightarrow$ Báo động Rò rỉ Gas.
   * Bấm vào cảm biến PIR $\rightarrow$ Báo động Xâm nhập.
6. Quan sát thông báo nổi (Push Notification) xuất hiện trên điện thoại của bạn ngay lập tức!

# LTDD2-CK
