# LAB 1: Ứng dụng Di Động React Native Nhận Thông Báo Đẩy

Ứng dụng React Native hiển thị giao diện trung tâm cảnh báo thông minh, nhận thông báo đẩy thời gian thực từ Firebase Cloud Messaging (FCM) thông qua Server Node.js khi các cảm biến IoT phát hiện sự cố.

---

## 1. Cài Đặt Môi Trường & Dependencies

Mở Terminal tại thư mục `mobile-app`:
```bash
cd mobile-app
npm install
```

---

## 2. Cách Chạy Ứng Dụng

Khởi động Metro Bundler:
```bash
npx expo start
```
* **Chạy trên điện thoại thật (Khuyên dùng):** Cài app **Expo Go** trên điện thoại (Android hoặc iOS), sau đó quét mã QR hiển thị ở terminal.
* Sau khi mở ứng dụng, màn hình sẽ hiển thị trạng thái và **Push Token**. Nhấn nút **📋 Sao chép Token** để lấy token đem đi test gửi từ Postman hoặc Server NodeJS.

---

## 3. Liên Kết Firebase Đầy Đủ (Khi Nộp Bài / Build Production)
1. Truy cập [Firebase Console](https://console.firebase.google.com/) $\rightarrow$ Chọn Project của bạn.
2. Thêm ứng dụng Android với package name: `com.iot.alertapp`.
3. Tải file `google-services.json` về và đặt trực tiếp vào thư mục `mobile-app/` (cùng cấp với `App.js`).
4. File cấu hình `app.json` đã được cài sẵn đường dẫn `"googleServicesFile": "./google-services.json"`.

