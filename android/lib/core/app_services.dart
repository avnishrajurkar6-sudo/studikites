import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:home_widget/home_widget.dart';
import 'package:in_app_update/in_app_update.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:url_launcher/url_launcher.dart';

/// Android permissions + home-screen widget + forced app updates.
class AppServices {
  AppServices._();

  static final FlutterLocalNotificationsPlugin _notifications = FlutterLocalNotificationsPlugin();
  static bool _notificationsReady = false;

  /// Request *everything* we declared. Returns a map of status per permission.
  static Future<Map<String, PermissionStatus>> requestAllPermissions() async {
    final permissions = <Permission>[
      Permission.notification,
      Permission.camera,
      Permission.microphone,
      Permission.speech,
      Permission.location,
      Permission.locationWhenInUse,
      Permission.locationAlways,
      Permission.photos,
      Permission.videos,
      Permission.audio,
      Permission.storage,
      Permission.contacts,
      Permission.calendarFullAccess,
      Permission.phone,
      Permission.bluetooth,
      Permission.bluetoothConnect,
      Permission.bluetoothScan,
      Permission.bluetoothAdvertise,
      Permission.manageExternalStorage,
      Permission.systemAlertWindow,
      Permission.requestInstallPackages,
      Permission.ignoreBatteryOptimizations,
      Permission.scheduleExactAlarm,
      Permission.accessNotificationPolicy,
      Permission.criticalAlerts,
      Permission.appTrackingTransparency,
    ];
    final out = <String, PermissionStatus>{};
    if (kIsWeb) return out;
    try {
      final statuses = await permissions.request();
      statuses.forEach((k, v) => out[k.toString()] = v);
    } catch (_) { /* some permissions are platform-specific */ }
    await requestHomeScreenWidget();
    await initNotifications();
    return out;
  }

  /// Ask the user to add a home-screen widget.
  static Future<bool> requestHomeScreenWidget() async {
    if (kIsWeb) return false;
    try {
      await HomeWidget.requestPinWidget(
        androidName: 'es.antonborri.home_widget.HomeWidgetProvider',
        qualifiedAndroidName: 'es.antonborri.home_widget.HomeWidgetProvider',
      );
      await HomeWidget.saveWidgetData<String>('title', 'StudiKitEZ');
      await HomeWidget.saveWidgetData<String>('body', 'Daily minutes');
      await HomeWidget.updateWidget(androidName: 'es.antonborri.home_widget.HomeWidgetProvider');
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<void> initNotifications() async {
    if (_notificationsReady || kIsWeb) return;
    try {
      await _notifications.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
      );
      await _notifications
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
      _notificationsReady = true;
    } catch (_) {}
  }

  static Future<void> showNotification({required String title, required String body}) async {
    await initNotifications();
    try {
      await _notifications.show(
        id: DateTime.now().millisecondsSinceEpoch % 100000,
        title: title,
        body: body,
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails('studikitesz', 'StudiKitEZ', importance: Importance.high, priority: Priority.high),
        ),
      );
    } catch (_) {}
  }

  /// Compulsory update check. Android Play Core immediate update; fallback opens store.
  static Future<void> checkForcedUpdate() async {
    if (kIsWeb) return;
    try {
      final info = await InAppUpdate.checkForUpdate();
      if (info.updateAvailability == UpdateAvailability.updateAvailable) {
        // Forced: ask user to download compulsory update immediately.
        try {
          await InAppUpdate.performImmediateUpdate();
        } catch (_) {
          await _openStore();
        }
      } else if (info.updateAvailability == UpdateAvailability.developerTriggeredUpdateInProgress) {
        try { await InAppUpdate.performImmediateUpdate(); } catch (_) {}
      }
    } catch (_) {
      await _openStoreIfSideloaded();
    }
  }

  static Future<void> _openStore() async {
    final pkg = await PackageInfo.fromPlatform().catchError((_) => PackageInfo(appName: '', packageName: '', version: '', buildNumber: '', buildSignature: ''));
    final uri = Uri.parse('https://play.google.com/store/apps/details?id=${pkg.packageName}');
    if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  static Future<void> _openStoreIfSideloaded() async { /* no Play store info; no-op */ }
}
