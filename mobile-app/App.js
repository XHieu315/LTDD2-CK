import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';

// ---------------------------------------------------------------------------
// 1. Cấu hình hành vi hiển thị khi nhận thông báo trong lúc mở App (Foreground)
// ---------------------------------------------------------------------------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function App() {
  const [expoPushToken, setExpoPushToken] = useState('');
  const [deviceToken, setDeviceToken] = useState('');
  const [notificationList, setNotificationList] = useState([]);
  const [syncStatus, setSyncStatus] = useState('Đang khởi tạo...');
  const [loading, setLoading] = useState(false);

  // Địa chỉ IP máy tính đang chạy Node.js Server
  const SERVER_URL = 'http://192.168.32.154:5000';

  const notificationListener = useRef();
  const responseListener = useRef();

  // Hàm gửi Push Token lên Server Node.js để đăng ký nhận cảnh báo
  const syncTokenWithServer = async (token) => {
    if (!token || token.includes('Chưa cấp quyền') || token.includes('Đang tạo')) return;
    try {
      setSyncStatus('Đang gửi token tới Server Node.js...');
      const res = await fetch(`${SERVER_URL}/api/register-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          device: `${Platform.OS.toUpperCase()} (${Device.modelName || 'Mobile'})`
        }),
      });
      const resJson = await res.json();
      if (resJson.success) {
        setSyncStatus(`✅ Đã đồng bộ với Server (${SERVER_URL})`);
        console.log('✅ Đã đồng bộ Token thành công với Server!');
      } else {
        setSyncStatus('⚠️ Server từ chối đăng ký Token');
      }
    } catch (e) {
      console.log('Chưa kết nối được Server Node.js:', e.message);
      setSyncStatus(`⚠️ Chưa kết nối Server (Kiểm tra ${SERVER_URL})`);
    }
  };

  // ---------------------------------------------------------------------------
  // 2. Đăng ký quyền & Lấy Push Token (FCM / Expo)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    registerForPushNotificationsAsync().then(({ expoToken, fcmToken }) => {
      const activeToken = expoToken || fcmToken;
      if (expoToken) setExpoPushToken(expoToken);
      if (fcmToken) setDeviceToken(fcmToken);
      if (!activeToken) {
        setExpoPushToken('Chưa cấp quyền thông báo');
        setSyncStatus('⚠️ Chưa cấp quyền thông báo');
      } else {
        // Tự động đồng bộ Token lên Server Node.js ngay khi có
        syncTokenWithServer(activeToken);
      }
    });

    // Lắng nghe khi có thông báo đẩy tới khi đang mở App (Foreground)
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('🔔 [Foreground Notification]:', notification);
      const title = notification.request.content.title || 'Cảnh báo mới';
      const body = notification.request.content.body || '';
      const data = notification.request.content.data || {};

      const newAlert = {
        id: Date.now().toString(),
        title,
        body,
        data,
        timestamp: new Date().toLocaleTimeString('vi-VN'),
      };

      setNotificationList(prev => [newAlert, ...prev]);
    });

    // Lắng nghe khi người dùng bấm vào thông báo từ Status Bar
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('👉 [User Click Notification]:', response);
      const { title, body } = response.notification.request.content;
      Alert.alert(`Chi tiết sự cố`, `${title}\n\n${body}`);
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  // Bắn thông báo test tại chỗ (Local Test)
  const triggerLocalTestNotification = async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ CẢNH BÁO: PHÁT HIỆN CHÁY (TEST)',
        body: 'Cảm biến lửa kích hoạt cảnh báo nguy cơ tại khu vực Bếp!',
        data: { location: 'Khu vực Bếp (Local Test)', alertType: 'FIRE' },
        sound: 'default',
      },
      trigger: null,
    });
  };

  // Hàm copy token vào bộ nhớ tạm
  const copyToClipboard = async (token) => {
    if (!token) return;
    await Clipboard.setStringAsync(token);
    Alert.alert('Đã sao chép!', 'Token đã được lưu vào bộ nhớ tạm (Clipboard).');
  };

  // Chọn icon tương ứng với loại cảnh báo
  const getAlertBadge = (title = '') => {
    const upper = title.toUpperCase();
    if (upper.includes('CHÁY') || upper.includes('FIRE')) return { icon: '🔥', color: '#ff3b30' };
    if (upper.includes('GAS')) return { icon: '💨', color: '#ff9500' };
    if (upper.includes('XÂM NHẬP') || upper.includes('TRỘM') || upper.includes('PIR')) return { icon: '🚨', color: '#af52de' };
    if (upper.includes('NHIỆT ĐỘ')) return { icon: '🌡️', color: '#007aff' };
    return { icon: '⚠️', color: '#ff2d55' };
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>HỆ THỐNG GIÁM SÁT IOT</Text>
        <Text style={styles.headerSubtitle}>Nhận thông báo đẩy từ Server & Cảm biến</Text>
      </View>

      {/* Box Token */}
      <View style={styles.tokenBox}>
        <View style={styles.statusRow}>
          <View style={styles.onlineDot} />
          <Text style={styles.statusText}>{syncStatus}</Text>
        </View>

        <Text style={styles.tokenLabel}>Push Token (Dùng để kiểm thử):</Text>
        <Text style={styles.tokenValue} numberOfLines={2}>
          {expoPushToken || deviceToken || 'Đang tạo Push Token...'}
        </Text>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btnCopy, { flex: 1, marginRight: 6 }]}
            onPress={() => copyToClipboard(expoPushToken || deviceToken)}
          >
            <Text style={styles.btnCopyText}>📋 Sao chép</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnSync, { flex: 1.2, marginRight: 6 }]}
            onPress={() => syncTokenWithServer(expoPushToken || deviceToken)}
          >
            <Text style={styles.btnSyncText}>🔄 Kết nối Server</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnTest, { flex: 0.9 }]}
            onPress={triggerLocalTestNotification}
          >
            <Text style={styles.btnTestText}>🔔 Bắn test</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Danh sách cảnh báo */}
      <View style={styles.body}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Lịch sử cảnh báo ({notificationList.length})
          </Text>
          {notificationList.length > 0 && (
            <TouchableOpacity onPress={() => setNotificationList([])}>
              <Text style={styles.btnClear}>Xoá hết</Text>
            </TouchableOpacity>
          )}
        </View>

        {notificationList.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🛡️</Text>
            <Text style={styles.emptyTitle}>Khu vực an toàn</Text>
            <Text style={styles.emptySubtitle}>
              Chưa có cảnh báo nào từ cảm biến (Nhiệt độ, Khí Gas, Cháy, Xâm nhập).
            </Text>
          </View>
        ) : (
          <FlatList
            data={notificationList}
            keyExtractor={item => item.id}
            renderItem={({ item }) => {
              const badge = getAlertBadge(item.title);
              return (
                <View style={[styles.alertCard, { borderLeftColor: badge.color }]}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.badgeIcon}>{badge.icon}</Text>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardTime}>{item.timestamp}</Text>
                  </View>
                  <Text style={styles.cardBody}>{item.body}</Text>
                  {item.data && Object.keys(item.data).length > 0 && (
                    <Text style={styles.cardMeta}>
                      Vị trí: {item.data.location || 'Smart Home'}
                    </Text>
                  )}
                </View>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// 3. Hàm xin quyền và đăng ký Notification Channel trên Android
// ---------------------------------------------------------------------------
async function registerForPushNotificationsAsync() {
  let expoToken = '';
  let fcmToken = '';

  if (Platform.OS === 'android') {
    // Tạo kênh ưu tiên cao nhất cho thông báo khẩn cấp IoT
    await Notifications.setNotificationChannelAsync('iot_emergency_channel', {
      name: 'Cảnh báo khẩn cấp IoT',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Alert.alert('Quyền thông báo', 'Ứng dụng cần được cấp quyền thông báo để nhận cảnh báo!');
      return { expoToken, fcmToken };
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId ??
      'd42a5e46-bd49-4998-ae54-6e8b074e105c';

    // 1. Lấy Expo Push Token (dùng với Expo Push API & FCM v1)
    try {
      const expoTokenObj = await Notifications.getExpoPushTokenAsync({ projectId });
      expoToken = expoTokenObj.data;
      console.log('📱 Expo Push Token:', expoToken);
    } catch (e) {
      console.log('Lỗi lấy Expo Push Token:', e.message);
    }

    // 2. Lấy FCM / APNs Device Token
    try {
      const deviceTokenObj = await Notifications.getDevicePushTokenAsync();
      fcmToken = deviceTokenObj.data;
      console.log('🔥 Device Token:', fcmToken);
    } catch (e) {
      console.log('Lỗi lấy Device Token:', e.message);
    }
  } else {
    console.log('Khuyến nghị: Chạy trên thiết bị thật (Physical Device) để nhận Push Notification!');
  }

  return { expoToken, fcmToken };
}

// ---------------------------------------------------------------------------
// 4. Stylesheet
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    paddingTop: Platform.OS === 'android' ? 40 : 10,
    paddingHorizontal: 20,
    paddingBottom: 15,
    backgroundColor: '#1e1e1e',
    borderBottomWidth: 1,
    borderBottomColor: '#2c2c2c',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9e9e9e',
    marginTop: 4,
  },
  tokenBox: {
    margin: 16,
    padding: 14,
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333333',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#34c759',
    marginRight: 8,
  },
  statusText: {
    color: '#34c759',
    fontSize: 13,
    fontWeight: '600',
  },
  tokenLabel: {
    color: '#b0b0b0',
    fontSize: 12,
    marginBottom: 4,
  },
  tokenValue: {
    color: '#e0e0e0',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    backgroundColor: '#262626',
    padding: 8,
    borderRadius: 6,
  },
  btnRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  btnCopy: {
    backgroundColor: '#e74c3c',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnCopyText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  btnSync: {
    backgroundColor: '#27ae60',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnSyncText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  btnTest: {
    backgroundColor: '#3498db',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnTestText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  btnClear: {
    fontSize: 13,
    color: '#e74c3c',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  emptyIcon: {
    fontSize: 50,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#888888',
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  alertCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 5,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  badgeIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#ffffff',
    flex: 1,
  },
  cardTime: {
    fontSize: 11,
    color: '#888888',
  },
  cardBody: {
    fontSize: 13,
    color: '#dddddd',
    lineHeight: 18,
  },
  cardMeta: {
    fontSize: 11,
    color: '#888888',
    marginTop: 6,
    fontStyle: 'italic',
  },
});

