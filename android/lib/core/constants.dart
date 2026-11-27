class AppConstants {
  AppConstants._();

  static const String appName = 'StudiKitEZ';
  static const String appId = 'studikitesz';
  static const String backendBaseUrl = String.fromEnvironment(
    'SK_BACKEND',
    defaultValue: 'https://studikitesz.avnishrajurkar6.workers.dev',
  );
  static const String siteUrl = String.fromEnvironment(
    'SK_SITE',
    defaultValue: 'https://studikitesz.pages.dev',
  );
  static const String telegramBotUrl = 'https://t.me/Studikitesbot';
  static const String telegramGroupUrl = 'https://t.me/studikitesz';
  static const String appRedirectScheme = 'studikitesz';
  static const String appRedirectUri = 'studikitesz://auth/callback';

  static const String prefsSessionKey = 'sk_session';
  static const String prefsUidKey = 'sk_uid';
  static const String prefsProviderKey = 'sk_provider';
  static const String prefsOnboardingKey = 'sk_onboarding_done';

  /// Authorization page on the site. The app opens this in a browser; the user
  /// signs in (Google or phone), grants permission, and is sent back with a
  /// short-lived, single-use code (or shown a code to paste manually).
  static String appAuthUrl({required String state}) {
    final params = Uri(queryParameters: {
      'app': appId,
      'redirect': appRedirectUri,
      'state': state,
    });
    return '$siteUrl/app-auth.html?${params.query}';
  }

  /// Website onboarding (also used by the app to complete missing fields).
  static const String webOnboardingUrl = '$siteUrl/onboarding.html';
}
