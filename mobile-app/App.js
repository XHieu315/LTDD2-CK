import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  TextInput,
  RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';

// Cấu hình hiển thị thông báo Foreground
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
  const [serverUrl, setServerUrl] = useState('http://192.168.32.154:5000');
  const [syncStatus, setSyncStatus] = useState('online'); // 'online' | 'syncing' | 'offline'
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Trạng thái cảm biến thời gian thực (Telemetry & Security State)
  const [sensors, setSensors] = useState({
    temperature: 28.5,
    humidity: 62.0,
    gasLevel: 420,
    flameDetected: false,
    motionDetected: false,
    lastUpdated: 'Vừa xong',
  });

  // Lịch sử cảnh báo
  const [alerts, setAlerts] = useState([]);

  const notificationListener = useRef();
  const responseListener = useRef();

  // ---------------------------------------------------------------------------
  // Đồng bộ Token với Server Node.js
  // ---------------------------------------------------------------------------
  const syncTokenWithServer = async (token, targetUrl = serverUrl) => {
    if (!token || token.includes('Chưa cấp quyền') || token.includes('Đang tạo')) return;
    try {
      setSyncStatus('syncing');
      const res = await fetch(`${targetUrl}/api/register-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          device: `${Platform.OS.toUpperCase()} (${Device.modelName || 'iPhone'})`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncStatus('online');
      } else {
        setSyncStatus('offline');
      }
    } catch {
      setSyncStatus('offline');
    }
  };

  // Kéo dữ liệu lịch sử từ Server
  const fetchHistoryFromServer = async () => {
    try {
      setRefreshing(true);
      const res = await fetch(`${serverUrl}/api/iot/history`);
      const resJson = await res.json();
      if (resJson && resJson.data) {
        setAlerts(resJson.data);
      }
    } catch (e) {
      console.log('Lỗi cập nhật lịch sử:', e.message);
    } finally {
      setRefreshing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Điều khiển thiết bị từ xa (Tắt còi báo động qua Server/MQTT)
  // ---------------------------------------------------------------------------
  const sendControlCommand = async (command = 'OFF') => {
    try {
      const res = await fetch(`${serverUrl}/api/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, device: 'buzzer' }),
      });
      const data = await res.json();
      if (data.success) {
        // Tắt trạng thái cảnh báo trên UI
        setSensors(prev => ({
          ...prev,
          flameDetected: false,
          gasLevel: 420,
          motionDetected: false,
        }));
        Alert.alert('Thành công', 'Đã gửi lệnh tắt còi báo động tới hệ thống IoT.');
      } else {
        Alert.alert('Lỗi', 'Không thể gửi lệnh điều khiển tới Broker.');
      }
    } catch (err) {
      Alert.alert('Lỗi kết nối', `Không thể liên lạc với Server: ${err.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Xử lý thông báo đẩy từ Firebase / Server
  // ---------------------------------------------------------------------------
  useEffect(() => {
    registerForPushNotificationsAsync().then(({ expoToken, fcmToken }) => {
      const token = expoToken || fcmToken;
      if (expoToken) setExpoPushToken(expoToken);
      if (fcmToken) setDeviceToken(fcmToken);
      if (token) {
        syncTokenWithServer(token);
      } else {
        setSyncStatus('offline');
      }
    });

    // Lắng nghe khi thông báo tới (Foreground)
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      const { title, body, data } = notification.request.content;
      const type = (data?.alertType || title || '').toUpperCase();

      // Cập nhật trạng thái cảm biến trực quan theo loại sự cố
      setSensors(prev => {
        const next = { ...prev, lastUpdated: new Date().toLocaleTimeString('vi-VN') };
        if (type.includes('CHÁY') || type.includes('FIRE')) next.flameDetected = true;
        if (type.includes('GAS')) next.gasLevel = data?.value ? Number(data.value) : 2500;
        if (type.includes('XÂM NHẬP') || type.includes('PIR')) next.motionDetected = true;
        if (type.includes('NHIỆT ĐỘ') && data?.value) next.temperature = Number(data.value);
        return next;
      });

      const newAlert = {
        id: Date.now().toString(),
        title: title || 'Cảnh báo hệ thống',
        body: body || 'Phát hiện sự cố từ cảm biến IoT',
        location: data?.location || 'Phòng Khách',
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type,
      };

      setAlerts(prev => [newAlert, ...prev]);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const { title, body } = response.notification.request.content;
      Alert.alert(title || 'Thông báo', body || '');
    });

    return () => {
      if (notificationListener.current) Notifications.removeNotificationSubscription(notificationListener.current);
      if (responseListener.current) Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  // Bắn thông báo giả lập tại chỗ
  const triggerLocalSimulation = async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ CẢNH BÁO: RÒ RỈ KHÍ GAS',
        body: 'Nồng độ khí gas vượt ngưỡng an toàn (2450 ppm) tại khu vực Bếp!',
        data: { alertType: 'GAS', value: '2450', location: 'Nhà Bếp' },
        sound: 'default',
      },
      trigger: null,
    });
  };

  const hasActiveDanger = sensors.flameDetected || sensors.gasLevel > 1800 || sensors.motionDetected || sensors.temperature > 45;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* --- TOP BAR --- */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.siteLabel}>HỆ THỐNG AN NINH & MÔI TRƯỜNG</Text>
          <Text style={styles.siteTitle}>Căn Hộ Thông Minh</Text>
        </View>

        <TouchableOpacity
          style={[styles.statusChip, syncStatus === 'online' ? styles.chipOnline : styles.chipOffline]}
          onPress={() => setShowConfigModal(true)}
        >
          <View style={[styles.statusDot, syncStatus === 'online' ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.statusChipText}>
            {syncStatus === 'online' ? 'EMQX • Connected' : 'Mất kết nối'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchHistoryFromServer} tintColor="#64748B" />}
      >
        {/* --- HERO SECURITY BANNER --- */}
        <View style={[styles.heroCard, hasActiveDanger ? styles.heroCardDanger : styles.heroCardSafe]}>
          <View style={styles.heroLeft}>
            <View style={[styles.heroIconBadge, hasActiveDanger ? styles.heroIconDanger : styles.heroIconSafe]}>
              <Text style={styles.heroIconText}>{hasActiveDanger ? '🚨' : '🛡️'}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.heroStatusHeading}>
                {hasActiveDanger ? 'PHÁT HIỆN SỰ CỐ KHẨN CẤP' : 'Hệ Thống Đang An Toàn'}
              </Text>
              <Text style={styles.heroStatusSub}>
                {hasActiveDanger
                  ? 'Một hoặc nhiều cảm biến kích hoạt cảnh báo nguy hiểm!'
                  : 'Tất cả 4 cảm biến (Nhiệt độ, Gas, Lửa, Trộm) đang hoạt động bình thường.'}
              </Text>
            </View>
          </View>

          {hasActiveDanger && (
            <TouchableOpacity style={styles.btnSilence} onPress={() => sendControlCommand('OFF')}>
              <Text style={styles.btnSilenceText}>🔇 TẮT CÒI BÁO ĐỘNG</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* --- SENSOR TELEMETRY SECTION --- */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionHeading}>TRẠNG THÁI CẢM BIẾN THỜI GIAN THỰC</Text>
          <Text style={styles.sectionCaption}>Wokwi ESP32 • Port 8883</Text>
        </View>

        <View style={styles.gridContainer}>
          {/* Tile 1: Nhiệt độ & Độ ẩm */}
          <View style={styles.sensorTile}>
            <View style={styles.tileHeader}>
              <Text style={styles.tileIcon}>🌡️</Text>
              <View style={[styles.tagBadge, sensors.temperature > 45 ? styles.tagDanger : styles.tagNormal]}>
                <Text style={styles.tagText}>{sensors.temperature > 45 ? 'QUÁ NHIỆT' : 'ỔN ĐỊNH'}</Text>
              </View>
            </View>
            <Text style={styles.tileValue}>{sensors.temperature.toFixed(1)}°C</Text>
            <Text style={styles.tileMetricLabel}>Độ ẩm: {sensors.humidity.toFixed(0)}% • DHT22</Text>
          </View>

          {/* Tile 2: Khí Gas MQ-2 */}
          <View style={styles.sensorTile}>
            <View style={styles.tileHeader}>
              <Text style={styles.tileIcon}>💨</Text>
              <View style={[styles.tagBadge, sensors.gasLevel > 1800 ? styles.tagDanger : styles.tagNormal]}>
                <Text style={styles.tagText}>{sensors.gasLevel > 1800 ? 'RÒ RỈ GAS' : 'AN TOÀN'}</Text>
              </View>
            </View>
            <Text style={[styles.tileValue, sensors.gasLevel > 1800 && { color: '#EF4444' }]}>
              {sensors.gasLevel} <Text style={styles.unitText}>ppm</Text>
            </Text>
            <Text style={styles.tileMetricLabel}>Ngưỡng chuẩn: &lt; 2000 ppm</Text>
          </View>

          {/* Tile 3: Cảm biến Cháy (Flame) */}
          <View style={styles.sensorTile}>
            <View style={styles.tileHeader}>
              <Text style={styles.tileIcon}>🔥</Text>
              <View style={[styles.tagBadge, sensors.flameDetected ? styles.tagDanger : styles.tagNormal]}>
                <Text style={styles.tagText}>{sensors.flameDetected ? 'CÓ LỬA' : 'AN TOÀN'}</Text>
              </View>
            </View>
            <Text style={[styles.tileValue, sensors.flameDetected && { color: '#EF4444' }]}>
              {sensors.flameDetected ? 'NGUY HIỂM' : 'Không có lửa'}
            </Text>
            <Text style={styles.tileMetricLabel}>Flame Sensor • Bếp / Khách</Text>
          </View>

          {/* Tile 4: Giám sát Xâm nhập PIR */}
          <View style={styles.sensorTile}>
            <View style={styles.tileHeader}>
              <Text style={styles.tileIcon}>👁️</Text>
              <View style={[styles.tagBadge, sensors.motionDetected ? styles.tagWarning : styles.tagNormal]}>
                <Text style={styles.tagText}>{sensors.motionDetected ? 'CÓ NGƯỜI' : 'YÊN TĨNH'}</Text>
              </View>
            </View>
            <Text style={[styles.tileValue, sensors.motionDetected && { color: '#F59E0B' }]}>
              {sensors.motionDetected ? 'Phát hiện' : 'Bình thường'}
            </Text>
            <Text style={styles.tileMetricLabel}>PIR Motion • Khu vực an ninh</Text>
          </View>
        </View>

        {/* --- QUICK ACTIONS BAR --- */}
        <View style={styles.actionsBar}>
          <TouchableOpacity style={styles.actionBtnSecondary} onPress={triggerLocalSimulation}>
            <Text style={styles.actionBtnSecondaryText}>⚡ Bắn thử cảnh báo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtnPrimary} onPress={fetchHistoryFromServer}>
            <Text style={styles.actionBtnPrimaryText}>🔄 Làm mới dữ liệu</Text>
          </TouchableOpacity>
        </View>

        {/* --- EVENT LOG SECTION --- */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionHeading}>NHẬT KÝ SỰ CỐ & CẢNH BÁO</Text>
          {alerts.length > 0 && (
            <TouchableOpacity onPress={() => setAlerts([])}>
              <Text style={styles.btnClearLog}>Xoá nhật ký</Text>
            </TouchableOpacity>
          )}
        </View>

        {alerts.length === 0 ? (
          <View style={styles.emptyLogBox}>
            <Text style={styles.emptyLogIcon}>📋</Text>
            <Text style={styles.emptyLogTitle}>Chưa có bản ghi sự cố nào</Text>
            <Text style={styles.emptyLogDesc}>
              Khi cảm biến phát hiện cháy, gas, trộm hoặc nhiệt độ bất thường, thông báo đẩy sẽ tự động lưu lại ở đây.
            </Text>
          </View>
        ) : (
          alerts.map(item => {
            const isFire = item.title?.includes('CHÁY') || item.type?.includes('FIRE');
            const isGas = item.title?.includes('GAS');
            const isPir = item.title?.includes('XÂM NHẬP') || item.type?.includes('PIR');
            const accentColor = isFire ? '#EF4444' : isGas ? '#F59E0B' : isPir ? '#A855F7' : '#3B82F6';

            return (
              <View key={item.id} style={[styles.alertRow, { borderLeftColor: accentColor }]}>
                <View style={styles.alertRowTop}>
                  <View style={styles.alertTypeWrapper}>
                    <Text style={[styles.alertBadgeText, { color: accentColor }]}>
                      {isFire ? '● KHẨN CẤP / CHÁY' : isGas ? '● RÒ RỈ KHÍ GAS' : isPir ? '● CẢNH BÁO AN NINH' : '● MÔI TRƯỜNG'}
                    </Text>
                  </View>
                  <Text style={styles.alertTimestamp}>{item.timestamp}</Text>
                </View>
                <Text style={styles.alertTitleText}>{item.title}</Text>
                <Text style={styles.alertBodyText}>{item.body}</Text>
                {item.location && (
                  <Text style={styles.alertLocationText}>📍 Vị trí: {item.location}</Text>
                )}
              </View>
            );
          })
        )}

        {/* --- SLEEK SYSTEM INFO FOOTER --- */}
        <TouchableOpacity style={styles.footerInfoCard} onPress={() => setShowConfigModal(true)}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, marginRight: 8 }}>⚙️</Text>
            <Text style={styles.footerInfoTitle}>Cấu hình Máy chủ & Push Token</Text>
          </View>
          <Text style={styles.footerInfoArrow}>›</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* --- MODAL CẤU HÌNH KỸ THUẬT --- */}
      <Modal visible={showConfigModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Cấu hình Trạm IoT Gateway</Text>
              <TouchableOpacity onPress={() => setShowConfigModal(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>ĐỊA CHỈ SERVER NODE.JS (LAB 2):</Text>
            <TextInput
              style={styles.textInput}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://192.168.x.x:5000"
              placeholderTextColor="#64748B"
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={styles.modalActionBtn}
              onPress={() => {
                syncTokenWithServer(expoPushToken || deviceToken, serverUrl);
                setShowConfigModal(false);
                Alert.alert('Đã cập nhật', `Đang kết nối tới ${serverUrl}`);
              }}
            >
              <Text style={styles.modalActionBtnText}>Lưu & Đồng bộ Server</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <Text style={styles.inputLabel}>MÃ PUSH TOKEN CỦA IPHONE:</Text>
            <Text style={styles.tokenCodeBox} numberOfLines={3} selectable>
              {expoPushToken || deviceToken || 'Chưa khởi tạo token'}
            </Text>

            <TouchableOpacity
              style={styles.modalCopyBtn}
              onPress={async () => {
                await Clipboard.setStringAsync(expoPushToken || deviceToken);
                Alert.alert('Đã sao chép', 'Mã token đã được copy vào bộ nhớ đệm.');
              }}
            >
              <Text style={styles.modalCopyBtnText}>📋 Sao chép Push Token</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Đăng ký quyền & Kênh thông báo Android / iOS
// ---------------------------------------------------------------------------
async function registerForPushNotificationsAsync() {
  let expoToken = '';
  let fcmToken = '';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('iot_emergency_channel', {
      name: 'Cảnh báo khẩn cấp IoT',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#EF4444',
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
      return { expoToken, fcmToken };
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId ??
      'd42a5e46-bd49-4998-ae54-6e8b074e105c';

    try {
      const expoTokenObj = await Notifications.getExpoPushTokenAsync({ projectId });
      expoToken = expoTokenObj.data;
    } catch (e) {
      console.log('Lỗi lấy Expo Push Token:', e.message);
    }

    try {
      const deviceTokenObj = await Notifications.getDevicePushTokenAsync();
      fcmToken = deviceTokenObj.data;
    } catch (e) {
      console.log('Lỗi lấy Device Token:', e.message);
    }
  }

  return { expoToken, fcmToken };
}

// ---------------------------------------------------------------------------
// STYLESHEET - Chuẩn Thiết Kế Smart Home Dashboard Hiện Đại (Slate & Emerald)
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0F19', // Dark Slate Blue cao cấp
  },
  topBar: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 40 : 12,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  siteLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  siteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.3,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  chipOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  dotOnline: {
    backgroundColor: '#10B981',
  },
  dotOffline: {
    backgroundColor: '#EF4444',
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  content: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
  },

  // HERO CARD
  heroCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 22,
    borderWidth: 1,
  },
  heroCardSafe: {
    backgroundColor: '#131D31',
    borderColor: '#1E293B',
  },
  heroCardDanger: {
    backgroundColor: '#2A1218',
    borderColor: '#EF4444',
  },
  heroLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconSafe: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  heroIconDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
  },
  heroIconText: {
    fontSize: 22,
  },
  heroStatusHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  heroStatusSub: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 16,
  },
  btnSilence: {
    marginTop: 14,
    backgroundColor: '#EF4444',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnSilenceText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.5,
  },

  // SECTION HEADINGS
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.8,
  },
  sectionCaption: {
    fontSize: 11,
    color: '#475569',
  },

  // 2X2 SENSOR GRID
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sensorTile: {
    width: '48.5%',
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  tileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tileIcon: {
    fontSize: 20,
  },
  tagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagNormal: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  tagWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  tagDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  tagText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
  },
  tileValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F9FAFB',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  unitText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  tileMetricLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },

  // ACTION BUTTONS
  actionsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  actionBtnSecondary: {
    flex: 1,
    marginRight: 8,
    backgroundColor: '#1F2937',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  actionBtnSecondaryText: {
    color: '#E5E7EB',
    fontWeight: '600',
    fontSize: 13,
  },
  actionBtnPrimary: {
    flex: 1,
    marginLeft: 8,
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },

  // ALERT LOG
  btnClearLog: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  emptyLogBox: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F2937',
    marginBottom: 20,
  },
  emptyLogIcon: {
    fontSize: 32,
    marginBottom: 8,
    opacity: 0.6,
  },
  emptyLogTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E5E7EB',
    marginBottom: 4,
  },
  emptyLogDesc: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 17,
  },
  alertRow: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  alertRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  alertTypeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  alertTimestamp: {
    fontSize: 11,
    color: '#6B7280',
  },
  alertTitleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F9FAFB',
    marginBottom: 4,
  },
  alertBodyText: {
    fontSize: 12,
    color: '#D1D5DB',
    lineHeight: 16,
  },
  alertLocationText: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 6,
    fontStyle: 'italic',
  },

  // FOOTER CHIP
  footerInfoCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#131D31',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  footerInfoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  footerInfoArrow: {
    fontSize: 18,
    color: '#64748B',
    fontWeight: '700',
  },

  // MODAL
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  modalCloseText: {
    fontSize: 18,
    color: '#9CA3AF',
    padding: 4,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 1,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#1F2937',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F9FAFB',
    fontSize: 13,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#374151',
  },
  modalActionBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  modalActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: '#1F2937',
    marginVertical: 14,
  },
  tokenCodeBox: {
    backgroundColor: '#0B0F19',
    borderRadius: 8,
    padding: 10,
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  modalCopyBtn: {
    backgroundColor: '#374151',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCopyBtnText: {
    color: '#E5E7EB',
    fontWeight: '600',
    fontSize: 13,
  },
});
