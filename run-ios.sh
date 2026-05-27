#!/bin/bash
set -e

UDID="5275B127-0C39-40FE-BE75-6AFA1AE00F40"
BUNDLE_ID="com.striveapp.app"
DERIVED="$HOME/Library/Developer/Xcode/DerivedData"

if [ "$1" = "--pods" ]; then
  echo "=== Pod install ==="
  cd ios
  /opt/homebrew/bin/pod install
  cd ..
fi

echo "=== Build ==="
xcodebuild \
  -workspace ios/Strive.xcworkspace \
  -scheme Strive \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "id=$UDID" \
  build | tail -3

APP_PATH=$(find "$DERIVED" -path "*/Debug-iphonesimulator/Strive.app" -maxdepth 5 2>/dev/null | head -1)

echo "=== Install + Launch ==="
xcrun simctl install "$UDID" "$APP_PATH"
xcrun simctl launch "$UDID" "$BUNDLE_ID"

echo "=== Done ==="
