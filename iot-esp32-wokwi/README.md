# LAB 3: Mô Phỏng ESP32 IoT trên Wokwi kết nối EMQX Cloud (Port 8883)

Hệ thống IoT sử dụng vi điều khiển ESP32, kết nối trực tiếp với **EMQX Cloud Broker** qua giao thức bảo mật **MQTTS (Port 8883 - SSL/TLS)**, đọc 4 cảm biến và bắn thông điệp MQTT thời gian thực.

---

## 1. Thông Tin Kết Nối EMQX Cloud
* **Broker Host:** `f122f61f.ala.asia-southeast1.emqxsl.com`
* **Port:** `8883` (SSL/TLS)
* **Username:** `hieu`
* **Password:** 123

---

## 2. Danh Sách Topic MQTT
| Topic | Hướng | Mô tả |
| :--- | :--- | :--- |
| `smarthome/telemetry` | ESP32 $\rightarrow$ EMQX | Dữ liệu định kỳ mỗi 5s (`temp`, `hum`, `gas`) |
| `smarthome/alert/fire` | ESP32 $\rightarrow$ EMQX | Bắn khi phát hiện lửa (Nút đỏ) |
| `smarthome/alert/gas` | ESP32 $\rightarrow$ EMQX | Bắn khi nồng độ gas $> 2000$ (Biến trở) |
| `smarthome/alert/pir` | ESP32 $\rightarrow$ EMQX | Bắn khi phát hiện người lạ (Cảm biến PIR) |
| `smarthome/alert/temp` | ESP32 $\rightarrow$ EMQX | Bắn khi nhiệt độ $> 45^\circ\text{C}$ hoặc $< 15^\circ\text{C}$ |
| `smarthome/control/#` | Node.js / MQTTX $\rightarrow$ ESP32 | Điều khiển thiết bị từ xa (ví dụ: tắt còi) |

---

## 3. Cách Chạy Trên Wokwi
1. Truy cập [Wokwi ESP32](https://wokwi.com/projects/new/esp32).
2. Copy code trong file `sketch.ino` dán vào tab `sketch.ino`.
3. Sửa dòng:
   ```cpp
   const char* MQTT_PASSWORD = "ĐIỀN_MẬT_KHẨU_CỦA_BẠN";
   ```
4. Copy sơ đồ mạch trong file `diagram.json` dán vào tab `diagram.json`.
5. Tab **Library Manager** (biểu tượng quyển sách): Thêm 3 thư viện:
   * `DHT sensor library`
   * `ArduinoJson`
   * `PubSubClient`
6. Nhấn nút **Play (Màu xanh)** để chạy mô phỏng.

---

## 4. Kiểm Tra Trên MQTTX
1. Mở phần mềm **MQTTX** trên máy tính.
2. Kết nối tới connection `EMQX_BROKER` đã có sẵn của bạn.
3. Nhấn **New Subscription** $\rightarrow$ Điền Topic: `smarthome/#`.
4. Toàn bộ dữ liệu cảm biến và cảnh báo từ Wokwi sẽ hiển thị trực tiếp trên MQTTX!
