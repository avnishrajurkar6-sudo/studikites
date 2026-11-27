import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'constants.dart';

class AppState extends ChangeNotifier {
  AppState();

  SharedPreferences? _prefs;
  String? _session;
  String? _uid;
  String _provider = '';
  Map<String, dynamic> _user = {};
  bool _onboardingDone = false;
  bool _loading = true;

  late final ApiClient api = ApiClient(sessionProvider: () async => _session);

  bool get isLoading => _loading;
  bool get isAuthenticated => _session != null && _session!.isNotEmpty;
  bool get isPhone => _provider == 'phone';
  bool get isAdmin => (_user['role']?.toString().toLowerCase() == 'admin');
  bool get onboardingDone => _onboardingDone;
  bool get needsOnboarding => isAuthenticated && !_onboardingDone;
  String? get session => _session;
  String? get uid => _uid;
  String get provider => _provider;
  Map<String, dynamic> get user => _user;

  String get displayName =>
      (_user['displayName'] ?? _user['name'] ?? _user['displayName'] ?? '').toString();

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    _session = _prefs!.getString(AppConstants.prefsSessionKey);
    _uid = _prefs!.getString(AppConstants.prefsUidKey);
    _provider = _prefs!.getString(AppConstants.prefsProviderKey) ?? '';
    _onboardingDone = _prefs!.getBool(AppConstants.prefsOnboardingKey) ?? false;
    _loading = false;
    notifyListeners();
    if (isAuthenticated) {
      await refreshMe();
    }
  }

  String _randomState() {
    final r = Random.secure();
    return List<int>.generate(24, (_) => r.nextInt(256)).map((e) => e.toRadixString(16).padLeft(2, '0')).join();
  }

  /// Returns the browser URL to open for site login + permission grant.
  String beginGoogleAuth() => AppConstants.appAuthUrl(state: _randomState());

  /// Handle an incoming deep link like studikitesz://auth/callback?code=...&state=...
  Future<bool> handleDeepLink(Uri uri) async {
    if (uri.scheme != AppConstants.appRedirectScheme) return false;
    final code = uri.queryParameters['code'];
    if (code == null || code.isEmpty) return false;
    await exchangeCode(code);
    return true;
  }

  Future<void> exchangeCode(String code) async {
    final res = await api.exchangeAppCode(code.trim());
    final session = (res['session'] ?? res['x-sk-session'] ?? '').toString();
    if (session.isEmpty) {
      throw ApiException(0, 'No session returned');
    }
    _session = session;
    _uid = (res['uid'] ?? '').toString();
    _provider = (res['provider'] ?? '').toString();
    await _prefs!.setString(AppConstants.prefsSessionKey, _session!);
    await _prefs!.setString(AppConstants.prefsUidKey, _uid ?? '');
    await _prefs!.setString(AppConstants.prefsProviderKey, _provider);
    notifyListeners();
    await refreshMe();
  }

  Future<void> refreshMe() async {
    try {
      final res = await api.me();
      _user = (res['user'] as Map?)?.cast<String, dynamic>() ?? (res['profile'] as Map?)?.cast<String, dynamic>() ?? {};
      _provider = _user['provider']?.toString() ?? _provider;
      _uid = _user['uid']?.toString() ?? _uid;
      _onboardingDone = _onboardingComplete(_user);
      await _prefs!.setBool(AppConstants.prefsOnboardingKey, _onboardingDone);
      notifyListeners();
    } catch (_) {
      // keep cached session; will retry
    }
  }

  static bool _onboardingComplete(Map<String, dynamic> u) {
    final o = (u['onboarding'] as Map?)?.cast<String, dynamic>() ?? {};
    final name = (u['displayName'] ?? u['name'] ?? '').toString().trim();
    final contact = (u['contactMobile'] ?? o['contactMobile'] ?? '').toString().replaceAll(RegExp(r'\D'), '');
    final batches = (o['batches'] as List? ?? const []).map((e) => e.toString()).where((e) => e.isNotEmpty).toList();
    final contactOk = RegExp(r'^[6-9]\d{9}$').hasMatch(contact.length >= 10 ? contact.substring(contact.length - 10) : contact);
    return o['done'] == true && name.length >= 2 && batches.isNotEmpty && contactOk;
  }

  /// Phone-number users: adopt the backend-signed session returned by
  /// /api/auth/verify-otp (provider=phone). Same logic as the website.
  Future<void> adoptPhoneSession({
    required String session,
    required String mobile,
    required String uid,
  }) async {
    _session = session;
    _uid = uid;
    _provider = 'phone';
    await _prefs!.setString(AppConstants.prefsSessionKey, session);
    await _prefs!.setString(AppConstants.prefsUidKey, uid);
    await _prefs!.setString(AppConstants.prefsProviderKey, 'phone');
    notifyListeners();
  }

  Future<void> logout() async {
    _session = null;
    _uid = null;
    _provider = '';
    _user = {};
    _onboardingDone = false;
    await _prefs!.remove(AppConstants.prefsSessionKey);
    await _prefs!.remove(AppConstants.prefsUidKey);
    await _prefs!.remove(AppConstants.prefsProviderKey);
    await _prefs!.remove(AppConstants.prefsOnboardingKey);
    notifyListeners();
  }
}
