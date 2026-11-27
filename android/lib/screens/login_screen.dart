import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/app_state.dart';
import '../core/api_client.dart';
import 'phone_login_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.appState});
  final AppState appState;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _codeController = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _google() async {
    setState(() { _busy = true; _error = null; });
    try {
      final url = widget.appState.beginGoogleAuth();
      final uri = Uri.parse(url);
      if (!await canLaunchUrl(uri)) throw Exception('Cannot open browser');
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      // Either we get a deep link back automatically, or the user pastes the
      // short-lived code shown on the site. The site page also has a manual code.
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _redeemCode() async {
    final code = _codeController.text.trim();
    if (code.isEmpty) return;
    setState(() { _busy = true; _error = null; });
    try {
      await widget.appState.exchangeCode(code);
      if (!mounted) return;
      Navigator.of(context).popUntil((r) => r.isFirst);
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Text('Continue with your StudiKitEZ account', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)).animate().fadeIn(),
            const SizedBox(height: 8),
            Text('Google sign-in happens on the site; you grant the app permission and return. Or use phone.', style: TextStyle(color: cs.onSurfaceVariant))
                .animate().fadeIn(delay: 100.ms),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _busy ? null : _google,
              icon: const Icon(Icons.account_circle_outlined),
              label: const Text('Continue with Google'),
            ).animate().fadeIn(delay: 200.ms),
            const SizedBox(height: 24),
            Row(children: [const Expanded(child: Divider()), Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Text('or', style: TextStyle(color: cs.onSurfaceVariant))), const Expanded(child: Divider())]),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _busy ? null : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => PhoneLoginScreen(appState: widget.appState))),
              icon: const Icon(Icons.phone_outlined),
              label: const Text('Continue with phone'),
            ),
            const SizedBox(height: 24),
            Text('Already authorized in the browser? Paste the temporary code:', style: TextStyle(color: cs.onSurfaceVariant, fontSize: 13)),
            const SizedBox(height: 8),
            TextField(
              controller: _codeController,
              decoration: const InputDecoration(hintText: 'Temporary authorization code', prefixIcon: Icon(Icons.key_outlined)),
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _redeemCode(),
            ),
            const SizedBox(height: 12),
            FilledButton.tonal(onPressed: _busy ? null : _redeemCode, child: const Text('Use code')),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: TextStyle(color: cs.error)),
            ],
            if (_busy) const Padding(padding: EdgeInsets.only(top: 16), child: Center(child: CircularProgressIndicator())),
          ],
        ),
      ),
    );
  }
}
