#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "DHT.h"
// ---------------------------------------------------------------------------
// 1. Cấu hình WiFi và EMQX Cloud Broker (Port 8883 SSL/TLS)
// ---------------------------------------------------------------------------
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

// Thông tin EMQX Cloud từ tài khoản của bạn:
const char* MQTT_BROKER   = "f122f61f.ala.asia-southeast1.emqxsl.com";
const int   MQTT_PORT     = 8883; // Cổng bảo mật SSL/TLS
const char* MQTT_USERNAME = "hieu";
const char* MQTT_PASSWORD = "123"; // Thay mật khẩu của bạn vào đây

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

  // Nếu nhận lệnh tắt còi báo động từ xa:
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
      // Đăng ký nhận lệnh điều khiển từ xa
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
// 6. Hàm Publish Cảnh Báo Lên EMQX
// ---------------------------------------------------------------------------
void publishAlert(const char* topic, String alertType, String message, float value) {
  triggerLocalAlarm();

  StaticJsonDocument<256> doc;
  doc["alert"]     = alertType;
  doc["msg"]       = message;
  doc["val"]       = value;
  doc["location"]  = "Nhà Thông Minh (Wokwi)";
  doc["timestamp"] = millis();

  char buffer[256];
  serializeJson(doc, buffer);

  Serial.println("\n--------------------------------------------------");
  Serial.print("🚀 [MQTT PUBLISH ALERT] Topic: ");
  Serial.println(topic);
  Serial.print("📦 Payload: ");
  Serial.println(buffer);

  if (mqttClient.publish(topic, buffer)) {
    Serial.println("✅ Đã gửi cảnh báo thành công lên EMQX Broker!");
  } else {
    Serial.println("❌ Lỗi khi publish cảnh báo!");
  }
  Serial.println("--------------------------------------------------\n");
}

// ---------------------------------------------------------------------------
// 7. Khởi tạo Thiết bị (setup)
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==================================================");
  Serial.println("🤖 ESP32 WOKWI + EMQX CLOUD BROKER (PORT 8883 TLS)");
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

  // Cấu hình TLS/SSL cho ESP32 (bỏ qua xác minh CA để chạy trơn tru trên Wokwi)
  espClient.setInsecure();

  // Cấu hình MQTT Client
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
}

// ---------------------------------------------------------------------------
// 8. Vòng lặp giám sát Cảm biến (loop)
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

  // 5. GỬI DỮ LIỆU TELEMETRY ĐỊNH KỲ (Mỗi 5 giây)
  if (currentMillis - lastTelemetryTime >= 5000) {
    StaticJsonDocument<128> teleDoc;
    teleDoc["temp"] = isnan(temperature) ? 25.0 : temperature;
    teleDoc["hum"]  = isnan(humidity) ? 60.0 : humidity;
    teleDoc["gas"]  = gasAnalogValue;

    char teleBuffer[128];
    serializeJson(teleDoc, teleBuffer);
    mqttClient.publish("smarthome/telemetry", teleBuffer);

    Serial.printf("[Telemetry -> EMQX] Temp: %.1f°C | Hum: %.1f%% | Gas: %d\n",
                  isnan(temperature) ? 0.0 : temperature,
                  isnan(humidity) ? 0.0 : humidity,
                  gasAnalogValue);

    lastTelemetryTime = currentMillis;
  }

  delay(200);
}
