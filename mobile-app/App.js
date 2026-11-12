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
  Switch,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';

// Cấu hình hiển thị thông báo đẩy khi App đang mở (Foreground)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function App() {
  // Navigation State (4 Tab chuyên nghiệp)
  const [activeTab, setActiveTab] = useState('DASHBOARD'); // 'DASHBOARD' | 'DEVICES' | 'ALERTS' | 'SETTINGS'

  // Device & Server States
  const [expoPushToken, setExpoPushToken] = useState('');
  const [deviceToken, setDeviceToken] = useState('');
  const [serverUrl, setServerUrl] = useState('https://ltdd-2-ck.vercel.app');
  const [syncStatus, setSyncStatus] = useState('online'); // 'online' | 'syncing' | 'offline'
  const [refreshing, setRefreshing] = useState(false);
  const [buzzerSwitch, setBuzzerSwitch] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState('ALL'); // 'ALL' | 'LIVING' | 'KITCHEN' | 'DOOR'
  const [logFilter, setLogFilter] = useState('ALL'); // 'ALL' | 'FIRE' | 'GAS' | 'PIR' | 'TEMP'

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
  // Điều khiển thiết bị từ xa (Tắt/Bật còi báo động qua Server/MQTT)
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
        if (command === 'OFF') {
          setSensors(prev => ({
            ...prev,
            flameDetected: false,
            gasLevel: 420,
            motionDetected: false,
          }));
          setBuzzerSwitch(false);
          Alert.alert('Thành công', 'Đã gửi lệnh tắt còi báo động tới hệ thống IoT.');
        } else {
          setBuzzerSwitch(true);
          Alert.alert('Thành công', 'Đã kích hoạt còi báo động trên phần cứng IoT.');
        }
      } else {
        Alert.alert('Lỗi', 'Không thể gửi lệnh điều khiển tới Broker.');
      }
    } catch (err) {
      Alert.alert('Lỗi kết nối', `Không thể liên lạc với Server: ${err.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Lắng nghe và xử lý thông báo đẩy từ Firebase / Expo
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

    fetchHistoryFromServer();

    // Lắng nghe khi nhận thông báo (Foreground)
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
        location: data?.location || 'Phòng Khách (Wokwi)',
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type,
      };

      setAlerts(prev => [newAlert, ...prev]);

      // Bật cửa sổ Popup khẩn cấp ngay trên màn hình nếu người dùng đang mở App
      Alert.alert(
        `🚨 ${title || 'CẢNH BÁO KHẨN CẤP'}`,
        `${body || 'Có sự cố phát sinh từ cảm biến IoT!'}\n\n📍 Vị trí: ${data?.location || 'Nhà Thông Minh'}`,
        [{ text: 'ĐÃ XÁC NHẬN', style: 'destructive' }]
      );
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

  // Bắn thông báo đẩy thật từ Server về iPhone (để test và demo cho thầy)
  const triggerPushTestFromCloud = async () => {
    try {
      const token = expoPushToken || deviceToken;
      if (!token) {
        Alert.alert('Chưa có Token', 'Ứng dụng chưa nhận được Push Token từ thiết bị.');
        return;
      }
      Alert.alert('Đang gửi...', 'Hệ thống đang phát lệnh Push Notification từ Vercel Cloud...');
      const res = await fetch(`${serverUrl}/api/notify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          title: '🔥 [DEMO] CẢNH BÁO CHÁY TỨC THÌ',
          body: 'Nhiệt độ phòng tăng vọt và phát hiện đám cháy tại khu vực Bếp!',
          data: { alertType: 'FIRE', value: '1', location: 'Khu vực Bếp (Wokwi)' }
        })
      });
      const data = await res.json();
      if (data.success) {
        Alert.alert('Đã gửi thành công', 'Thông báo Push Notification đã được Vercel Cloud chuyển tiếp tới iPhone!');
      } else {
        Alert.alert('Lỗi gửi', data.error || 'Server phản hồi lỗi.');
      }
    } catch (e) {
      Alert.alert('Lỗi kết nối', e.message);
    }
  };

  const hasActiveDanger = sensors.flameDetected || sensors.gasLevel > 1800 || sensors.motionDetected || sensors.temperature > 45;

  // Lọc danh sách sự cố theo category
  const filteredAlerts = alerts.filter(item => {
    if (logFilter === 'ALL') return true;
    const str = (item.title + ' ' + (item.type || '') + ' ' + (item.alertType || '')).toUpperCase();
    if (logFilter === 'FIRE') return str.includes('CHÁY') || str.includes('FIRE');
    if (logFilter === 'GAS') return str.includes('GAS');
    if (logFilter === 'PIR') return str.includes('XÂM NHẬP') || str.includes('PIR');
    if (logFilter === 'TEMP') return str.includes('NHIỆT ĐỘ') || str.includes('TEMP');
    return true;
  });

  // ---------------------------------------------------------------------------
  // RENDER TRANG 1: TỔNG QUAN (DASHBOARD)
  // ---------------------------------------------------------------------------
  const renderDashboardScreen = () => (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.scrollPadding}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchHistoryFromServer} tintColor="#64748B" />}
    >
      {/* Banner Trạng thái An ninh */}
      <View style={[styles.heroCard, hasActiveDanger ? styles.heroCardDanger : styles.heroCardSafe]}>
        <View style={styles.heroLeft}>
          <View style={[styles.heroIconBadge, hasActiveDanger ? styles.heroIconDanger : styles.heroIconSafe]}>
            <Text style={styles.heroIconText}>{hasActiveDanger ? '🚨' : '🛡️'}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.heroStatusHeading}>
              {hasActiveDanger ? 'CẢNH BÁO SỰ CỐ KHẨN CẤP' : 'Hệ Thống Đang An Toàn'}
            </Text>
            <Text style={styles.heroStatusSub}>
              {hasActiveDanger
                ? 'Một hoặc nhiều cảm biến vượt ngưỡng cho phép!'
                : 'Tất cả 4 cảm biến (Lửa, Gas, Nhiệt độ, Xâm nhập) hoạt động ổn định.'}
            </Text>
          </View>
        </View>

        {hasActiveDanger && (
          <TouchableOpacity style={styles.btnSilence} onPress={() => sendControlCommand('OFF')}>
            <Text style={styles.btnSilenceText}>🔇 TẮT CÒI BÁO ĐỘNG NGAY</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tiêu đề mục cảm biến */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeading}>THÔNG SỐ MÔI TRƯỜNG & AN NINH</Text>
        <Text style={styles.sectionCaption}>Cập nhật: {sensors.lastUpdated}</Text>
      </View>

      {/* Lưới 4 Card Cảm biến */}
      <View style={styles.gridContainer}>
        {/* Card 1: Nhiệt độ & Độ ẩm */}
        <View style={styles.sensorTile}>
          <View style={styles.tileHeader}>
            <Text style={styles.tileIcon}>🌡️</Text>
            <View style={[styles.tagBadge, sensors.temperature > 45 ? styles.tagDanger : styles.tagNormal]}>
              <Text style={styles.tagText}>{sensors.temperature > 45 ? 'QUÁ NHIỆT' : 'ỔN ĐỊNH'}</Text>
            </View>
          </View>
          <Text style={styles.tileValue}>{sensors.temperature.toFixed(1)}°C</Text>
          <Text style={styles.tileMetricLabel}>Độ ẩm: {sensors.humidity.toFixed(0)}% • DHT22</Text>
          <Text style={styles.tilePinInfo}>GPIO 15 • Phòng Khách</Text>
        </View>

        {/* Card 2: Khí Gas MQ-2 */}
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
          <Text style={styles.tilePinInfo}>GPIO 34 • Gian Bếp</Text>
        </View>

        {/* Card 3: Cảm biến Cháy Flame */}
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
          <Text style={styles.tileMetricLabel}>Cảm biến quang nhiệt</Text>
          <Text style={styles.tilePinInfo}>GPIO 14 • Bếp / Khách</Text>
        </View>

        {/* Card 4: Giám sát Xâm nhập PIR */}
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
          <Text style={styles.tileMetricLabel}>Hồng ngoại chuyển động</Text>
          <Text style={styles.tilePinInfo}>GPIO 13 • Cửa Chính</Text>
        </View>
      </View>

      {/* Thanh Phím Tắt Thao Tác Nhanh */}
      <View style={styles.quickBarContainer}>
        <TouchableOpacity style={styles.quickBtnAlert} onPress={() => sendControlCommand('OFF')}>
          <Text style={styles.quickBtnIcon}>🔇</Text>
          <Text style={styles.quickBtnText}>Tắt Còi</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.quickBtnNormal} onPress={triggerPushTestFromCloud}>
          <Text style={styles.quickBtnIcon}>⚡</Text>
          <Text style={styles.quickBtnText}>Bắn Thử</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.quickBtnNormal} onPress={fetchHistoryFromServer}>
          <Text style={styles.quickBtnIcon}>🔄</Text>
          <Text style={styles.quickBtnText}>Làm Mới</Text>
        </TouchableOpacity>
      </View>

      {/* Sự cố mới ghi nhận gần nhất */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeading}>SỰ CỐ GẦN ĐÂY</Text>
        <TouchableOpacity onPress={() => setActiveTab('ALERTS')}>
          <Text style={styles.sectionLink}>Xem tất cả ({alerts.length}) ›</Text>
        </TouchableOpacity>
      </View>

      {alerts.slice(0, 2).map((item, idx) => {
        const isFire = (item.title + ' ' + (item.alertType || '')).toUpperCase().includes('CHÁY');
        const isGas = (item.title + ' ' + (item.alertType || '')).toUpperCase().includes('GAS');
        const accent = isFire ? '#EF4444' : isGas ? '#F59E0B' : '#A855F7';
        return (
          <View key={item.id || idx} style={[styles.recentAlertCard, { borderLeftColor: accent }]}>
            <View style={styles.recentAlertTop}>
              <Text style={[styles.recentAlertBadge, { color: accent }]}>
                {item.alertType || item.title || 'CẢNH BÁO'}
              </Text>
              <Text style={styles.recentAlertTime}>{item.timestamp || 'Mới đây'}</Text>
            </View>
            <Text style={styles.recentAlertMsg} numberOfLines={2}>{item.message || item.body}</Text>
          </View>
        );
      })}
    </ScrollView>
  );

  // ---------------------------------------------------------------------------
  // RENDER TRANG 2: THIẾT BỊ & PHÒNG (DEVICES & ROOMS)
  // ---------------------------------------------------------------------------
  const renderDevicesScreen = () => (
    <ScrollView style={styles.screenScroll} contentContainerStyle={styles.scrollPadding} showsVerticalScrollIndicator={false}>
      {/* Bộ Lọc Khu Vực / Phòng */}
      <View style={styles.filterRow}>
        {[
          { key: 'ALL', label: 'Tất cả' },
          { key: 'LIVING', label: 'Phòng Khách' },
          { key: 'KITCHEN', label: 'Gian Bếp' },
          { key: 'DOOR', label: 'Cửa Ra Vào' },
        ].map(r => (
          <TouchableOpacity
            key={r.key}
            style={[styles.filterChip, selectedRoom === r.key && styles.filterChipActive]}
            onPress={() => setSelectedRoom(r.key)}
          >
            <Text style={[styles.filterChipText, selectedRoom === r.key && styles.filterChipTextActive]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Danh sách Thiết bị phần cứng */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeading}>CƠ CẤU CHẤP HÀNH & NÚT IOT</Text>
        <Text style={styles.sectionCaption}>Giao thức MQTT Port 8883</Text>
      </View>

      {/* Thiết bị 1: Bo ESP32 Gateway */}
      <View style={styles.deviceCard}>
        <View style={styles.deviceCardHeader}>
          <View style={styles.deviceIconCircle}>
            <Text style={{ fontSize: 20 }}>📟</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.deviceTitle}>ESP32 Microcontroller Node</Text>
            <Text style={styles.deviceSubtitle}>Mô phỏng Wokwi • WiFi: Wokwi-GUEST</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: '#064E3B' }]}>
            <Text style={[styles.statusPillText, { color: '#34D399' }]}>HOẠT ĐỘNG</Text>
          </View>
        </View>
        <View style={styles.deviceMetaRow}>
          <Text style={styles.deviceMetaItem}>Broker: EMQX Cloud (TLS)</Text>
          <Text style={styles.deviceMetaItem}>Firmware: v2.4 TLS</Text>
        </View>
      </View>

      {/* Thiết bị 2: Còi Báo Động Buzzer */}
      <View style={styles.deviceCard}>
        <View style={styles.deviceCardHeader}>
          <View style={[styles.deviceIconCircle, buzzerSwitch && { backgroundColor: '#7F1D1D' }]}>
            <Text style={{ fontSize: 20 }}>📢</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.deviceTitle}>Còi Báo Động Buzzer (GPIO 4)</Text>
            <Text style={styles.deviceSubtitle}>Tần số: 1000 Hz • Công suất: 85 dB</Text>
          </View>
          <Switch
            value={buzzerSwitch || hasActiveDanger}
            onValueChange={val => {
              setBuzzerSwitch(val);
              sendControlCommand(val ? 'ON' : 'OFF');
            }}
            trackColor={{ false: '#334155', true: '#DC2626' }}
            thumbColor="#F8FAFC"
          />
        </View>
        <View style={styles.deviceMetaRow}>
          <Text style={styles.deviceMetaItem}>Kích hoạt tự động khi có cháy/gas</Text>
          <Text style={styles.deviceMetaItem}>{buzzerSwitch ? '🔴 Đang reo còi' : '⚪ Đang tắt'}</Text>
        </View>
      </View>

      {/* Thiết bị 3: Đèn LED Cảnh Báo Khẩn */}
      <View style={styles.deviceCard}>
        <View style={styles.deviceCardHeader}>
          <View style={[styles.deviceIconCircle, hasActiveDanger && { backgroundColor: '#7F1D1D' }]}>
            <Text style={{ fontSize: 20 }}>🚨</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.deviceTitle}>Đèn LED Đỏ Báo Động (GPIO 2)</Text>
            <Text style={styles.deviceSubtitle}>Nhấp nháy đồng bộ khi có sự cố</Text>
          </View>
          <View style={[styles.statusPill, hasActiveDanger ? { backgroundColor: '#7F1D1D' } : { backgroundColor: '#1E293B' }]}>
            <Text style={[styles.statusPillText, hasActiveDanger ? { color: '#F87171' } : { color: '#94A3B8' }]}>
              {hasActiveDanger ? 'SÁNG' : 'TẮT'}
            </Text>
          </View>
        </View>
      </View>

      {/* Bảng Ngưỡng Cảnh Báo Hệ Thống */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeading}>NGƯỠNG KÍCH HOẠT AN TOÀN (CONFIG)</Text>
      </View>

      <View style={styles.rulesContainer}>
        <View style={styles.ruleItem}>
          <Text style={styles.ruleLabel}>Nhiệt độ cảnh báo cao (DHT22)</Text>
          <Text style={styles.ruleValue}>&gt; 45.0 °C</Text>
        </View>
        <View style={styles.ruleItem}>
          <Text style={styles.ruleLabel}>Nhiệt độ cảnh báo thấp</Text>
          <Text style={styles.ruleValue}>&lt; 15.0 °C</Text>
        </View>
        <View style={styles.ruleItem}>
          <Text style={styles.ruleLabel}>Nồng độ khí gas nguy hiểm (MQ-2)</Text>
          <Text style={styles.ruleValue}>&gt; 2000 ppm</Text>
        </View>
        <View style={styles.ruleItem}>
          <Text style={styles.ruleLabel}>Thời gian giãn cách cảnh báo (Cooldown)</Text>
          <Text style={styles.ruleValue}>15 giây</Text>
        </View>
      </View>
    </ScrollView>
  );

  // ---------------------------------------------------------------------------
  // RENDER TRANG 3: NHẬT KÝ SỰ CỐ (ACTIVITY LOGS & ALERTS)
  // ---------------------------------------------------------------------------
  const renderAlertsScreen = () => (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.scrollPadding}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchHistoryFromServer} tintColor="#64748B" />}
    >
      {/* Thẻ Thống kê nhanh */}
      <View style={styles.statsCard}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{alerts.length}</Text>
          <Text style={styles.statLabel}>Tổng sự cố</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: '#EF4444' }]}>
            {alerts.filter(a => (a.title + ' ' + (a.type || '') + ' ' + (a.alertType || '')).toUpperCase().includes('CHÁY')).length}
          </Text>
          <Text style={styles.statLabel}>Báo cháy</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: '#F59E0B' }]}>
            {alerts.filter(a => (a.title + ' ' + (a.type || '') + ' ' + (a.alertType || '')).toUpperCase().includes('GAS')).length}
          </Text>
          <Text style={styles.statLabel}>Rò Gas</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: '#A855F7' }]}>
            {alerts.filter(a => (a.title + ' ' + (a.type || '') + ' ' + (a.alertType || '')).toUpperCase().includes('PIR') || (a.title || '').includes('XÂM NHẬP')).length}
          </Text>
          <Text style={styles.statLabel}>Xâm nhập</Text>
        </View>
      </View>

      {/* Bộ Lọc Danh Mục */}
      <View style={styles.filterRow}>
        {[
          { key: 'ALL', label: 'Tất cả' },
          { key: 'FIRE', label: 'Cháy' },
          { key: 'GAS', label: 'Gas' },
          { key: 'PIR', label: 'An ninh' },
          { key: 'TEMP', label: 'Nhiệt độ' },
        ].map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, logFilter === f.key && styles.filterChipActive]}
            onPress={() => setLogFilter(f.key)}
          >
            <Text style={[styles.filterChipText, logFilter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tiêu đề & Nút Xoá */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeading}>DANH SÁCH CHI TIẾT ({filteredAlerts.length})</Text>
        {alerts.length > 0 && (
          <TouchableOpacity onPress={() => setAlerts([])}>
            <Text style={styles.btnClearLog}>Xoá bộ nhớ tạm</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Danh sách bản ghi */}
      {filteredAlerts.length === 0 ? (
        <View style={styles.emptyLogBox}>
          <Text style={styles.emptyLogIcon}>🛡️</Text>
          <Text style={styles.emptyLogTitle}>Không có sự cố nào</Text>
          <Text style={styles.emptyLogDesc}>
            Toàn bộ các phòng đang an toàn. Khi phát hiện cháy, gas, trộm hoặc nhiệt độ bất thường, bản ghi sẽ tự động xuất hiện tại đây.
          </Text>
        </View>
      ) : (
        filteredAlerts.map((item, index) => {
          const rawText = (item.title + ' ' + (item.type || '') + ' ' + (item.alertType || '')).toUpperCase();
          const isFire = rawText.includes('CHÁY') || rawText.includes('FIRE');
          const isGas = rawText.includes('GAS');
          const isPir = rawText.includes('XÂM NHẬP') || rawText.includes('PIR');
          const isTemp = rawText.includes('NHIỆT ĐỘ') || rawText.includes('TEMP');

          const accentColor = isFire ? '#EF4444' : isGas ? '#F59E0B' : isPir ? '#A855F7' : '#3B82F6';
          const icon = isFire ? '🔥' : isGas ? '💨' : isPir ? '👁️' : '🌡️';
          const badgeTitle = isFire ? 'KHẨN CẤP / CHÁY' : isGas ? 'RÒ RỈ KHÍ GAS' : isPir ? 'CẢNH BÁO AN NINH' : 'MÔI TRƯỜNG';

          return (
            <View key={item.id || index} style={[styles.alertDetailCard, { borderLeftColor: accentColor }]}>
              <View style={styles.alertDetailTop}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, marginRight: 6 }}>{icon}</Text>
                  <Text style={[styles.alertBadgeText, { color: accentColor }]}>● {badgeTitle}</Text>
                </View>
                <Text style={styles.alertTimestamp}>{item.timestamp || 'Vừa xong'}</Text>
              </View>

              <Text style={styles.alertTitleText}>{item.title || item.alertType}</Text>
              <Text style={styles.alertBodyText}>{item.message || item.body}</Text>

              <View style={styles.alertFooterRow}>
                {item.value !== null && item.value !== undefined && (
                  <Text style={styles.alertValueTag}>Chỉ số: {String(item.value)}</Text>
                )}
                <Text style={styles.alertLocationTag}>📍 {item.location || 'Nhà Thông Minh'}</Text>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );

  // ---------------------------------------------------------------------------
  // RENDER TRANG 4: CÀI ĐẶT & HỆ THỐNG (SETTINGS & SYSTEM)
  // ---------------------------------------------------------------------------
  const renderSettingsScreen = () => (
    <ScrollView style={styles.screenScroll} contentContainerStyle={styles.scrollPadding} showsVerticalScrollIndicator={false}>
      {/* Nhóm 1: Kết nối Cloud Gateway */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeading}>CLOUD BACKEND GATEWAY (LAB 2)</Text>
      </View>

      <View style={styles.settingCard}>
        <Text style={styles.inputLabel}>SERVERLESS API VERCEL:</Text>
        <TextInput
          style={styles.settingInput}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="https://..."
          placeholderTextColor="#64748B"
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={styles.settingBtn}
          onPress={() => {
            syncTokenWithServer(expoPushToken || deviceToken, serverUrl);
            Alert.alert('Thành công', `Đã lưu và đồng bộ với: ${serverUrl}`);
          }}
        >
          <Text style={styles.settingBtnText}>Lưu & Kiểm tra kết nối Cloud</Text>
        </TouchableOpacity>
      </View>

      {/* Nhóm 2: Thông tin Broker MQTT */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeading}>EMQX CLOUD BROKER (SSL/TLS)</Text>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Host Broker:</Text>
          <Text style={styles.settingValue}>f122f61f.ala.asia-southeast1.emqxsl.com</Text>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Cổng kết nối:</Text>
          <Text style={styles.settingValue}>8883 (MQTTS TLS Encrypted)</Text>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Data Integration:</Text>
          <Text style={[styles.settingValue, { color: '#34D399' }]}>HTTP Server Webhook (Active)</Text>
        </View>
      </View>

      {/* Nhóm 3: Push Notification Device Token */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeading}>THIẾT BỊ DI ĐỘNG & PUSH NOTIFICATION</Text>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Thiết bị:</Text>
          <Text style={styles.settingValue}>{Platform.OS.toUpperCase()} ({Device.modelName || 'iPhone'})</Text>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Dịch vụ Push:</Text>
          <Text style={styles.settingValue}>Expo Push Notification v2</Text>
        </View>

        <Text style={[styles.inputLabel, { marginTop: 10 }]}>EXPO PUSH TOKEN CỦA BẠN:</Text>
        <Text style={styles.tokenBox} selectable numberOfLines={2}>
          {expoPushToken || deviceToken || 'Chưa nhận được Token'}
        </Text>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <TouchableOpacity
            style={[styles.settingBtnSecondary, { flex: 1 }]}
            onPress={async () => {
              await Clipboard.setStringAsync(expoPushToken || deviceToken);
              Alert.alert('Đã sao chép', 'Token đã lưu vào khay nhớ tạm.');
            }}
          >
            <Text style={styles.settingBtnSecondaryText}>📋 Copy Token</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.settingBtn, { flex: 1.2 }]}
            onPress={triggerPushTestFromCloud}
          >
            <Text style={styles.settingBtnText}>🔔 Gửi Test Push</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Nhóm 4: Thông tin Đồ án & Tác giả */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeading}>THÔNG TIN HỌC PHẦN</Text>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Học phần:</Text>
          <Text style={styles.settingValue}>Lập trình Thiết bị Di động 2 (LTDD 2)</Text>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Đề tài:</Text>
          <Text style={styles.settingValue}>Hệ Thống Báo Động & Giám Sát IoT</Text>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Kiến trúc:</Text>
          <Text style={styles.settingValue}>Wokwi ESP32 + EMQX + Vercel + React Native</Text>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Phiên bản:</Text>
          <Text style={styles.settingValue}>v2.0.0 Pro Architecture</Text>
        </View>
      </View>
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* --- TOP BAR CỐ ĐỊNH --- */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.siteLabel}>HỆ THỐNG AN NINH & MÔI TRƯỜNG IOT</Text>
          <Text style={styles.siteTitle}>
            {activeTab === 'DASHBOARD' && 'Tổng Quan Nhà Thông Minh'}
            {activeTab === 'DEVICES' && 'Quản Lý Thiết Bị & Phòng'}
            {activeTab === 'ALERTS' && 'Nhật Ký Cảnh Báo Sự Cố'}
            {activeTab === 'SETTINGS' && 'Cấu Hình Trạm & Hệ Thống'}
          </Text>
        </View>

        <View style={[styles.statusChip, syncStatus === 'online' ? styles.chipOnline : styles.chipOffline]}>
          <View style={[styles.statusDot, syncStatus === 'online' ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.statusChipText}>
            {syncStatus === 'online' ? 'Online' : 'Offline'}
          </Text>
        </View>
      </View>

      {/* --- PHẦN NỘI DUNG THAY ĐỔI THEO TAB --- */}
      <View style={styles.contentContainer}>
        {activeTab === 'DASHBOARD' && renderDashboardScreen()}
        {activeTab === 'DEVICES' && renderDevicesScreen()}
        {activeTab === 'ALERTS' && renderAlertsScreen()}
        {activeTab === 'SETTINGS' && renderSettingsScreen()}
      </View>

      {/* --- BOTTOM TAB BAR (ĐIỀU HƯỚNG 4 TRANG CHUYÊN NGHIỆP) --- */}
      <View style={styles.bottomTabBar}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('DASHBOARD')}
        >
          <Text style={[styles.tabIcon, activeTab === 'DASHBOARD' && styles.tabIconActive]}>🏠</Text>
          <Text style={[styles.tabText, activeTab === 'DASHBOARD' && styles.tabTextActive]}>Tổng quan</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('DEVICES')}
        >
          <Text style={[styles.tabIcon, activeTab === 'DEVICES' && styles.tabIconActive]}>🎛️</Text>
          <Text style={[styles.tabText, activeTab === 'DEVICES' && styles.tabTextActive]}>Thiết bị</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('ALERTS')}
        >
          <View>
            <Text style={[styles.tabIcon, activeTab === 'ALERTS' && styles.tabIconActive]}>🔔</Text>
            {alerts.length > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{alerts.length > 9 ? '9+' : alerts.length}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.tabText, activeTab === 'ALERTS' && styles.tabTextActive]}>Nhật ký</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab('SETTINGS')}
        >
          <Text style={[styles.tabIcon, activeTab === 'SETTINGS' && styles.tabIconActive]}>⚙️</Text>
          <Text style={[styles.tabText, activeTab === 'SETTINGS' && styles.tabTextActive]}>Cài đặt</Text>
        </TouchableOpacity>
      </View>
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
      return { expoToken: 'Chưa cấp quyền thông báo', fcmToken: '' };
    }

    try {
      const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? 'd42a5e46-bd49-4998-ae54-6e8b074e105c';
      const pushData = await Notifications.getExpoPushTokenAsync({ projectId });
      expoToken = pushData.data;
      console.log('📲 EXPO PUSH TOKEN:', expoToken);
    } catch (err) {
      console.log('Lỗi lấy Expo Push Token:', err.message);
    }

    try {
      const fcmData = await Notifications.getDevicePushTokenAsync();
      fcmToken = fcmData.data;
    } catch {
      // Bỏ qua nếu chạy giả lập
    }
  }

  return { expoToken, fcmToken };
}

// ---------------------------------------------------------------------------
// BẢNG PHONG CÁCH GIAO DIỆN (COMMERCIAL IOT DESIGN - DARK SLATE)
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#090D16',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#162032',
    backgroundColor: '#090D16',
  },
  siteLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  siteTitle: {
    fontSize: 18,
    fontWeight: '700',
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
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: '#059669',
  },
  chipOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: '#DC2626',
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
    fontWeight: '700',
    color: '#E2E8F0',
  },
  contentContainer: {
    flex: 1,
  },
  screenScroll: {
    flex: 1,
  },
  scrollPadding: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 90, // Chừa khoảng trống cho Bottom Tab Bar
  },

  // HERO BANNER
  heroCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  heroCardSafe: {
    backgroundColor: '#0D211A',
    borderColor: '#065F46',
  },
  heroCardDanger: {
    backgroundColor: '#2A0E11',
    borderColor: '#991B1B',
  },
  heroLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconSafe: {
    backgroundColor: '#064E3B',
  },
  heroIconDanger: {
    backgroundColor: '#7F1D1D',
  },
  heroIconText: {
    fontSize: 22,
  },
  heroStatusHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 3,
  },
  heroStatusSub: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 16,
  },
  btnSilence: {
    backgroundColor: '#DC2626',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  btnSilenceText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.5,
  },

  // SECTION HEADING
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 10,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 1.1,
  },
  sectionCaption: {
    fontSize: 11,
    color: '#475569',
  },
  sectionLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38BDF8',
  },

  // GRID CẢM BIẾN
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  sensorTile: {
    width: '48%',
    backgroundColor: '#121A2B',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
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
    borderRadius: 4,
  },
  tagNormal: {
    backgroundColor: 'rgba(51, 65, 85, 0.6)',
  },
  tagDanger: {
    backgroundColor: '#7F1D1D',
  },
  tagWarning: {
    backgroundColor: '#78350F',
  },
  tagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  tileValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  unitText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  tileMetricLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 4,
  },
  tilePinInfo: {
    fontSize: 10,
    color: '#475569',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // QUICK BAR
  quickBarContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  quickBtnAlert: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#7F1D1D',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#991B1B',
  },
  quickBtnNormal: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  quickBtnIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  quickBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F8FAFC',
  },

  // RECENT ALERT PREVIEW
  recentAlertCard: {
    backgroundColor: '#121A2B',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  recentAlertTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  recentAlertBadge: {
    fontSize: 11,
    fontWeight: '800',
  },
  recentAlertTime: {
    fontSize: 10,
    color: '#64748B',
  },
  recentAlertMsg: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 16,
  },

  // FILTER ROW
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#121A2B',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  filterChipActive: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // DEVICE SCREEN CARDS
  deviceCard: {
    backgroundColor: '#121A2B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  deviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  deviceSubtitle: {
    fontSize: 11,
    color: '#64748B',
  },
  deviceMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  deviceMetaItem: {
    fontSize: 11,
    color: '#94A3B8',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // RULES CONTAINER
  rulesContainer: {
    backgroundColor: '#121A2B',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 16,
  },
  ruleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1A2438',
  },
  ruleLabel: {
    fontSize: 12,
    color: '#94A3B8',
  },
  ruleValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38BDF8',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // STATS CARD
  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#121A2B',
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  statDivider: {
    width: 1,
    height: '60%',
    backgroundColor: '#1E293B',
    alignSelf: 'center',
  },

  // ALERTS SCREEN
  btnClearLog: {
    fontSize: 11,
    color: '#EF4444',
    fontWeight: '700',
  },
  emptyLogBox: {
    backgroundColor: '#121A2B',
    borderRadius: 14,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  emptyLogIcon: {
    fontSize: 34,
    marginBottom: 10,
  },
  emptyLogTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E2E8F0',
    marginBottom: 4,
  },
  emptyLogDesc: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 17,
  },
  alertDetailCard: {
    backgroundColor: '#121A2B',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  alertDetailTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  alertBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  alertTimestamp: {
    fontSize: 11,
    color: '#64748B',
  },
  alertTitleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 3,
  },
  alertBodyText: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 17,
    marginBottom: 8,
  },
  alertFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1A2438',
  },
  alertValueTag: {
    fontSize: 11,
    color: '#F59E0B',
    fontWeight: '700',
  },
  alertLocationTag: {
    fontSize: 11,
    color: '#64748B',
  },

  // SETTINGS SCREEN
  settingCard: {
    backgroundColor: '#121A2B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#1A2438',
  },
  settingLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  settingValue: {
    fontSize: 12,
    color: '#E2E8F0',
    fontWeight: '600',
  },
  settingInput: {
    backgroundColor: '#090D16',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  settingBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  settingBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  settingBtnSecondary: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  settingBtnSecondaryText: {
    color: '#E2E8F0',
    fontWeight: '600',
    fontSize: 12,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 1,
    marginBottom: 6,
  },
  tokenBox: {
    backgroundColor: '#090D16',
    borderRadius: 8,
    padding: 10,
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    borderWidth: 1,
    borderColor: '#1E293B',
  },

  // BOTTOM TAB BAR
  bottomTabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Platform.OS === 'ios' ? 78 : 62,
    paddingBottom: Platform.OS === 'ios' ? 18 : 6,
    flexDirection: 'row',
    backgroundColor: '#0C1322',
    borderTopWidth: 1,
    borderTopColor: '#162032',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    flex: 1,
  },
  tabIcon: {
    fontSize: 20,
    opacity: 0.45,
    marginBottom: 3,
  },
  tabIconActive: {
    opacity: 1,
    transform: [{ scale: 1.1 }],
  },
  tabText: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#38BDF8',
    fontWeight: '800',
  },
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
