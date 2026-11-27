import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_state.dart';
import '../core/api_client.dart';

class PhoneLoginScreen extends StatefulWidget {
  const PhoneLoginScreen({super.key, required this.appState});
  final AppState appState;

  @override
  State<PhoneLoginScreen> createState() => _PhoneLoginScreenState();
}

class _PhoneLoginScreenState extends State<PhoneLoginScreen> {
  final _mobile = TextEditingController();
  final _otp = TextEditingController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  bool _codeSent = false;
  bool _needProfile = false;
  bool _busy = false;
  String? _error;
  final String _deviceId = 'sk-app-device';

  static final RegExp _mobileRe = RegExp(r'^[6-9]\d{9}$');
  static final RegExp _emailRe = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

  String _digits10(String v) {
    final d = v.replaceAll(RegExp(r'\D'), '');
    return d.length >= 10 ? d.substring(d.length - 10) : d;
  }

  Future<void> _sendOtp() async {
    final m = _digits10(_mobile.text);
    if (!_mobileRe.hasMatch(m)) { setState(() => _error = 'Enter a valid 10-digit Indian mobile number'); return; }
    setState(() { _busy = true; _error = null; });
    try {
      await widget.appState.api.post('/api/auth/send-otp', body: {'mobile': m, 'deviceId': _deviceId});
      setState(() => _codeSent = true);
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : e.toString());
    } finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _verifyOtp() async {
    final m = _digits10(_mobile.text);
    final otp = _otp.text.replaceAll(RegExp(r'\D'), '');
    if (otp.length < 4 || otp.length > 8) { setState(() => _error = 'Enter the OTP'); return; }
    setState(() { _busy = true; _error = null; });
    try {
      final res = await widget.appState.api.post('/api/auth/verify-otp', body: {'mobile': m, 'otp': otp, 'deviceId': _deviceId});
      final session = ((res as Map)['session'] ?? '').toString();
      if (session.isEmpty) throw Exception('No session');
      // Phone logic works the same: backend-signed session, provider=phone.
      final appState = widget.appState;
      // exchange phone session directly
      await appState.adoptPhoneSession(session: session, mobile: m, uid: 'phone_$m');
      // sync + check new-user name/email requirement
      try { await appState.api.post('/api/auth/profile', body: {'action': 'sync'}); } catch (_) {}
      await appState.refreshMe();
      final hasName = appState.displayName.trim().isNotEmpty;
      final hasEmail = (appState.user['email']?.toString().trim().isNotEmpty ?? false);
      if (!hasName || !hasEmail) { setState(() => _needProfile = true); return; }
      if (!mounted) return;
      Navigator.of(context).popUntil((r) => r.isFirst);
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : e.toString());
    } finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _saveProfile() async {
    if (_name.text.trim().isEmpty) { setState(() => _error = 'Please tell us your name'); return; }
    if (!_emailRe.hasMatch(_email.text.trim())) { setState(() => _error = 'Please enter a valid email'); return; }
    setState(() { _busy = true; _error = null; });
    try {
      await widget.appState.api.post('/api/auth/profile', body: {'action': 'save-profile', 'name': _name.text.trim(), 'email': _email.text.trim()});
      await widget.appState.refreshMe();
      if (!mounted) return;
      Navigator.of(context).popUntil((r) => r.isFirst);
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : e.toString());
    } finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Phone sign in')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Text('Continue with your number', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)).animate().fadeIn(),
            const SizedBox(height: 16),
            TextField(
              controller: _mobile,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91 ', prefixIcon: Icon(Icons.phone_outlined)),
              onSubmitted: (_) => _sendOtp(),
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: _busy ? null : _sendOtp, child: const Text('Send OTP')),
            if (_codeSent) ...[
              const SizedBox(height: 20),
              TextField(
                controller: _otp,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'OTP', prefixIcon: Icon(Icons.lock_outline)),
                onSubmitted: (_) => _verifyOtp(),
              ),
              const SizedBox(height: 12),
              FilledButton.tonal(onPressed: _busy ? null : _verifyOtp, child: const Text('Verify OTP')),
            ],
            if (_needProfile) ...[
              const SizedBox(height: 24),
              Text('New number — finish your profile', style: TextStyle(fontWeight: FontWeight.w800, color: cs.primary)),
              const SizedBox(height: 8),
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'Your name *')),
              const SizedBox(height: 8),
              TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email *')),
              const SizedBox(height: 12),
              FilledButton(onPressed: _busy ? null : _saveProfile, child: const Text('Save')),
              Text('New phone numbers can’t reach content until name + email are saved.', style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12)),
            ],
            if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: TextStyle(color: cs.error))],
            if (_busy) const Padding(padding: EdgeInsets.only(top: 16), child: Center(child: CircularProgressIndicator())),
          ],
        ),
      ),
    );
  }
}
