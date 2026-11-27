import 'package:flutter_test/flutter_test.dart';

import 'package:studikitesz/core/app_state.dart';
import 'package:studikitesz/main.dart';

void main() {
  testWidgets('StudiKitEZ app boots', (WidgetTester tester) async {
    await tester.pumpWidget(StudiKitEZApp(appState: AppState()));
    await tester.pump();
    expect(find.byType(StudiKitEZApp), findsOneWidget);
  });
}
