#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// ---------------------------------------------------------------------------
// 1. Cấu hình WiFi, EMQX Cloud Broker và Vercel Cloud API
// ---------------------------------------------------------------------------
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

// A. Thông tin EMQX Cloud Broker (Port 8883 MQTTS)
const char* MQTT_BROKER   = "f122f61f.ala.asia-southeast1.emqxsl.com";
const int   MQTT_PORT     = 8883; 
const char* MQTT_USERNAME = "hieu";
const char* MQTT_PASSWORD = "123"; 

// B. Đường dẫn API Server NodeJS đã deploy lên Vercel Cloud (LAB 3)
const char* VERCEL_API_URL = "https://ltdd-2-ck.vercel.app/api/iot/alert";

// ---------------------------------------------------------------------------
// 2. Chân Cảm biến & Cơ cấu chấp hành
// ---------------------------------------------------------------------------
#define PIN_DHT        15     // Data DHT22 (Nhiệt độ & Độ ẩm)
#define PIN_PIR        13     // OUT của cảm biến chuyển động PIR
#define PIN_FLAME      14     // Nút nhấn giả lập Cháy (LOW khi có lửa)
#define PIN_MQ2_GAS    34     // Potentiometer giả lập Gas MQ-2 (Analog 0-4095)

#define PIN_LED_ALARM  2      // Đèn LED đỏ báo động
#define PIN_BUZZER     4      // Còi báo động Buzzer

#define DHTTYPE DHT22
DHT dht(PIN_DHT, DHTTYPE);

// Đối tượng WiFi Secure & MQTT Client
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

// Ngưỡng cảnh báo
const float TEMP_HIGH_THRESHOLD = 45.0; // Nhiệt độ cao > 45°C
const float TEMP_LOW_THRESHOLD  = 15.0; // Nhiệt độ thấp < 15°C
const int   GAS_HIGH_THRESHOLD  = 2000; // Khí Gas nguy hiểm (> 2000 / 4095)

// Chống spam (Cooldown 15 giây cho mỗi loại cảnh báo)
unsigned long lastTempAlertTime  = 0;
unsigned long lastFlameAlertTime = 0;
unsigned long lastGasAlertTime   = 0;
unsigned long lastPirAlertTime   = 0;
unsigned long lastTelemetryTime  = 0;
const unsigned long ALERT_COOLDOWN = 15000; 

// ---------------------------------------------------------------------------
// 3. Hàm kích hoạt Còi & Đèn báo động tại chỗ
// ---------------------------------------------------------------------------
void triggerLocalAlarm() {
  digitalWrite(PIN_LED_ALARM, HIGH);
  tone(PIN_BUZZER, 1000, 500); // Kêu 1000Hz trong 500ms
  delay(500);
  digitalWrite(PIN_LED_ALARM, LOW);
}

// ---------------------------------------------------------------------------
// 4. Lắng nghe lệnh điều khiển ngược từ Node.js / MQTTX (ví dụ: Tắt còi)
// ---------------------------------------------------------------------------
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.print("📥 [Lệnh Điều Khiển Nhận Được] Topic: ");
  Serial.print(topic);
  Serial.print(" | Payload: ");
  Serial.println(message);

  if (String(topic).indexOf("control") >= 0) {
    if (message.indexOf("OFF") >= 0) {
      noTone(PIN_BUZZER);
      digitalWrite(PIN_LED_ALARM, LOW);
      Serial.println("🔇 Đã tắt còi báo động theo lệnh từ xa!");
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Hàm kết nối và duy trì kết nối EMQX Cloud Broker
// ---------------------------------------------------------------------------
void connectToMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("🔌 Đang kết nối tới EMQX Cloud (Port 8883)... ");
    String clientId = "ESP32_Wokwi_" + String(random(0xffff), HEX);

    if (mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
      Serial.println("✅ Kết nối EMQX thành công!");
      mqttClient.subscribe("smarthome/control/#");
      Serial.println("📡 Đã subscribe topic điều khiển: smarthome/control/#");
    } else {
      Serial.print("❌ Thất bại, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" -> Thử lại sau 3 giây...");
      delay(3000);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Hàm Gọi API HTTP POST lên Vercel Cloud (LAB 3 - Kích hoạt Push Notification)
// ---------------------------------------------------------------------------
void sendHttpAlertToVercel(String alertType, String message, float value) {
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClientSecure httpsClient;
    httpsClient.setInsecure(); // Bỏ qua kiểm tra chứng chỉ SSL để chạy trên Wokwi

    HTTPClient http;
    http.begin(httpsClient, VERCEL_API_URL);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> doc;
    doc["alertType"] = alertType;
    doc["message"]   = message;
    doc["value"]     = value;
    doc["location"]  = "Nhà Thông Minh (Wokwi)";

    String requestBody;
    serializeJson(doc, requestBody);

    Serial.println("🌐 [CALL API VERCEL CLOUD]: " + String(VERCEL_API_URL));
    int httpCode = http.POST(requestBody);

    if (httpCode > 0) {
      String response = http.getString();
      Serial.printf("✅ [Vercel Phản Hồi] Code: %d | Body: %s\n", httpCode, response.c_str());
      Serial.println("📲 Server Vercel đã gửi Push Notification tới iPhone thành công!");
    } else {
      Serial.printf("❌ [Lỗi Gọi Vercel] Code: %d (%s)\n", httpCode, http.errorToString(httpCode).c_str());
    }

    http.end();
  }
}

// ---------------------------------------------------------------------------
// 7. Hàm Xử Lý Cảnh Báo (Gửi song song MQTT cho MQTTX và HTTP cho Vercel)
// ---------------------------------------------------------------------------
void publishAlert(const char* topic, String alertType, String message, float value) {
  triggerLocalAlarm();

  // BƯỚC 1: Publish lên EMQX Broker (Cho phần mềm MQTTX nhận realtime)
  StaticJsonDocument<256> doc;
  doc["alert"]     = alertType;
  doc["msg"]       = message;
  doc["val"]       = value;
  doc["location"]  = "Nhà Thông Minh (Wokwi)";
  doc["timestamp"] = millis();

  char buffer[256];
  serializeJson(doc, buffer);

  Serial.println("\n--------------------------------------------------");
  Serial.print("🚀 [1. BẮN MQTT CHO MQTTX] Topic: ");
  Serial.println(topic);
  mqttClient.publish(topic, buffer);

  // BƯỚC 2: Gọi API POST lên Vercel Cloud (Để Vercel bắn Push Notification về iPhone)
  sendHttpAlertToVercel(alertType, message, value);
  Serial.println("--------------------------------------------------\n");
}

// ---------------------------------------------------------------------------
// 8. Khởi tạo Thiết bị (setup)
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==================================================");
  Serial.println("🤖 ESP32 WOKWI: EMQX MQTT + VERCEL CLOUD API");
  Serial.println("==================================================");

  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_FLAME, INPUT_PULLUP);
  pinMode(PIN_LED_ALARM, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_LED_ALARM, LOW);

  dht.begin();

  // Kết nối WiFi Wokwi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("📡 Đang kết nối WiFi Wokwi-GUEST");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi đã kết nối thành công!");

  // Cấu hình TLS/SSL cho MQTT
  espClient.setInsecure();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
}

// ---------------------------------------------------------------------------
// 9. Vòng lặp giám sát Cảm biến (loop)
// ---------------------------------------------------------------------------
void loop() {
  if (!mqttClient.connected()) {
    connectToMQTT();
  }
  mqttClient.loop();

  unsigned long currentMillis = millis();

  // 1. CẢM BIẾN NHIỆT ĐỘ & ĐỘ ẨM (DHT22)
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  if (!isnan(temperature)) {
    if (temperature >= TEMP_HIGH_THRESHOLD && (currentMillis - lastTempAlertTime >= ALERT_COOLDOWN)) {
      publishAlert(
        "smarthome/alert/temp",
        "NHIỆT ĐỘ QUÁ CAO",
        "Nhiệt độ phòng tăng vọt vượt ngưỡng an toàn!",
        temperature
      );
      lastTempAlertTime = currentMillis;
    } else if (temperature <= TEMP_LOW_THRESHOLD && (currentMillis - lastTempAlertTime >= ALERT_COOLDOWN)) {
      publishAlert(
        "smarthome/alert/temp",
        "NHIỆT ĐỘ QUÁ THẤP",
        "Nhiệt độ phòng hạ thấp bất thường, nguy cơ đóng băng!",
        temperature
      );
      lastTempAlertTime = currentMillis;
    }
  }

  // 2. CẢM BIẾN PHÁT HIỆN CHÁY (Nút bấm đỏ)
  int flameStatus = digitalRead(PIN_FLAME);
  if (flameStatus == LOW && (currentMillis - lastFlameAlertTime >= ALERT_COOLDOWN)) {
    publishAlert(
      "smarthome/alert/fire",
      "PHÁT HIỆN CHÁY",
      "CẢNH BÁO KHẨN CẤP: Phát hiện có ngọn lửa bùng phát trong nhà!",
      1.0
    );
    lastFlameAlertTime = currentMillis;
  }

  // 3. CẢM BIẾN KHÍ GAS (Biến trở MQ-2)
  int gasAnalogValue = analogRead(PIN_MQ2_GAS);
  if (gasAnalogValue >= GAS_HIGH_THRESHOLD && (currentMillis - lastGasAlertTime >= ALERT_COOLDOWN)) {
    publishAlert(
      "smarthome/alert/gas",
      "RÒ RỈ KHÍ GAS",
      "Phát hiện nồng độ khí Gas nguy hiểm trong không khí!",
      gasAnalogValue
    );
    lastGasAlertTime = currentMillis;
  }

  // 4. CẢM BIẾN CHUYỂN ĐỘNG PIR
  int pirStatus = digitalRead(PIN_PIR);
  if (pirStatus == HIGH && (currentMillis - lastPirAlertTime >= ALERT_COOLDOWN)) {
    publishAlert(
      "smarthome/alert/pir",
      "PHÁT HIỆN XÂM NHẬP",
      "Phát hiện có chuyển động lạ trong khu vực an ninh!",
      1.0
    );
    lastPirAlertTime = currentMillis;
  }

  // 5. GỬI DỮ LIỆU TELEMETRY ĐỊNH KỲ LÊN MQTTX (Mỗi 5 giây)
  if (currentMillis - lastTelemetryTime >= 5000) {
    StaticJsonDocument<128> teleDoc;
    teleDoc["temp"] = isnan(temperature) ? 25.0 : temperature;
    teleDoc["hum"]  = isnan(humidity) ? 60.0 : humidity;
    teleDoc["gas"]  = gasAnalogValue;

    char teleBuffer[128];
    serializeJson(teleDoc, teleBuffer);
    mqttClient.publish("smarthome/telemetry", teleBuffer);

    Serial.printf("[Telemetry -> MQTTX] Temp: %.1f°C | Hum: %.1f%% | Gas: %d\n",
                  isnan(temperature) ? 0.0 : temperature,
                  isnan(humidity) ? 0.0 : humidity,
                  gasAnalogValue);

    lastTelemetryTime = currentMillis;
  }

  delay(200);
}
