import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'constants.dart';

/// Thin API client over the StudiKitEZ Vercel backend.
/// Authentication uses the backend-signed `x-sk-session` (never a Firebase
/// token inside the app). The app never sends a uid; identity comes from the
/// signed session, exactly like phone users on the website.
class ApiClient {
  ApiClient({required this.sessionProvider, this.baseUrl = AppConstants.backendBaseUrl});

  final Future<String?> Function() sessionProvider;
  final String baseUrl;

  Future<Map<String, String>> _headers() async {
    final session = await sessionProvider();
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (session != null && session.isNotEmpty) 'x-sk-session': session,
    };
  }

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    final base = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    final p = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$base$p').replace(
      queryParameters: query?.map((k, v) => MapEntry(k, '$v')),
    );
  }

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, dynamic>? query,
  }) async {
    final headers = await _headers();
    http.Response res;
    final uri = _uri(path, query);
    final payload = body == null ? null : jsonEncode(body);
    try {
      switch (method) {
        case 'GET':
          res = await http.get(uri, headers: headers).timeout(const Duration(seconds: 25));
          break;
        case 'POST':
          res = await http.post(uri, headers: headers, body: payload).timeout(const Duration(seconds: 25));
          break;
        default:
          throw ApiException(0, 'Unsupported method');
      }
    } on TimeoutException {
      throw ApiException(0, 'Request timed out');
    } catch (e) {
      throw ApiException(0, 'Network unreachable: $e');
    }

    dynamic decoded;
    if (res.body.isNotEmpty) {
      try {
        decoded = jsonDecode(res.body);
      } catch (_) {
        decoded = res.body;
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final msg = (decoded is Map && decoded['error'] is String)
          ? decoded['error'] as String
          : 'Request failed (${res.statusCode})';
      throw ApiException(res.statusCode, msg, decoded);
    }
    return decoded;
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) => _send('GET', path, query: query);
  Future<dynamic> post(String path, {Map<String, dynamic>? body}) => _send('POST', path, body: body ?? {});

  // ---- Auth ----
  Future<Map<String, dynamic>> exchangeAppCode(String code) async {
    final r = await post('/api/auth/app-login', body: {'action': 'exchange', 'code': code});
    return (r as Map).cast<String, dynamic>();
  }

  Future<Map<String, dynamic>> me() async {
    final r = await get('/api/auth/app-me');
    return (r as Map).cast<String, dynamic>();
  }

  // ---- Onboarding ----
  Future<void> saveOnboarding(OnboardingData data) async {
    await post('/api/auth/app-onboarding', body: data.toJson());
  }

  // ---- Leaderboard ----
  Future<List<LeaderRow>> leaderboard({int limit = 40}) async {
    final r = await get('/api/auth/app-leaderboard', query: {'limit': limit});
    final list = (r is Map ? r['rows'] : r) as List? ?? const [];
    return list.map((e) => LeaderRow.fromJson((e as Map).cast<String, dynamic>())).toList();
  }

  Future<void> updateLeaderboardProfile({required String displayName, required bool hidden}) async {
    await post('/api/auth/leaderboard', body: {'action': 'update', 'displayName': displayName, 'hidden': hidden});
  }

  Future<void> suspendLeaderboardUser({required String uid, required bool suspended}) async {
    await post('/api/auth/leaderboard', body: {'action': 'suspend', 'uid': uid, 'suspended': suspended});
  }

  // ---- Courses ----
  Future<List<dynamic>> batches() async {
    final r = await get('/api/courses/batches');
    if (r is Map && r['new'] is List) return (r['new'] as List) + (r['old'] as List? ?? const []);
    if (r is Map && r['batches'] is List) return r['batches'] as List;
    if (r is List) return r;
    return const [];
  }
}

class ApiException implements Exception {
  ApiException(this.status, this.message, [this.data]);
  final int status;
  final String message;
  final dynamic data;
  @override
  String toString() => 'ApiException($status): $message';
}

class OnboardingData {
  OnboardingData({
    required this.displayName,
    required this.contactMobile,
    required this.batches,
    this.goal = 'board',
    this.dailyMinutes = 30,
    this.level = 'beginner',
    this.reminders = true,
  });

  final String displayName;
  final String contactMobile;
  final List<String> batches;
  final String goal;
  final int dailyMinutes;
  final String level;
  final bool reminders;

  static final RegExp _mobile = RegExp(r'^[6-9]\d{9}$');

  static String _digits10(String v) {
    final d = v.replaceAll(RegExp(r'\D'), '');
    return d.length >= 10 ? d.substring(d.length - 10) : d;
  }

  /// Which compulsory fields are missing / invalid. Empty = complete.
  static List<String> missingFields({
    required String displayName,
    required String contactMobile,
    required List<String> batches,
  }) {
    final missing = <String>[];
    if (displayName.trim().length < 2) missing.add('name');
    if (!_mobile.hasMatch(_digits10(contactMobile))) missing.add('contactMobile');
    if (batches.isEmpty) missing.add('batches');
    return missing;
  }

  Map<String, dynamic> toJson() => {
        'displayName': displayName.trim(),
        'contactMobile': _digits10(contactMobile),
        'batches': batches,
        'goal': goal,
        'dailyMinutes': dailyMinutes,
        'level': level,
        'reminders': reminders,
      };
}

class LeaderRow {
  LeaderRow({
    required this.uid,
    required this.name,
    required this.xp,
    this.streak = 0,
    this.hidden = false,
    this.suspended = false,
    this.role = '',
  });

  final String uid;
  final String name;
  final int xp;
  final int streak;
  final bool hidden;
  final bool suspended;
  final String role;

  factory LeaderRow.fromJson(Map<String, dynamic> j) => LeaderRow(
        uid: '${j['uid'] ?? ''}',
        name: '${j['name'] ?? j['displayName'] ?? 'Learner'}',
        xp: (j['xp'] is num ? j['xp'] as num : num.tryParse('${j['xp']}') ?? 0).toInt(),
        streak: (j['streak'] is num ? j['streak'] as num : 0).toInt(),
        hidden: j['hidden'] == true,
        suspended: j['suspended'] == true,
        role: '${j['role'] ?? ''}',
      );
}
