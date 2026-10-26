#!/usr/bin/env bash
# Build a signed release APK (WebView wrapper) without Gradle:
# aapt2 (resources+manifest) -> javac -> d8 -> zipalign -> apksigner.
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${ANDROID_SDK:-$HOME/android-sdk}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
A=android
OUT=$A/build
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
rm -rf "$OUT" && mkdir -p "$OUT/classes" "$OUT/dex" "$A/assets"
# web game + launcher icons
cp dist/standalone.html "$A/assets/index.html"
python3 - <<'EOF'
import sys
sys.path.insert(0, 'tools')
from icons import make
import os
for d, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    os.makedirs(f'android/res/mipmap-{d}', exist_ok=True)
    make(s).save(f'android/res/mipmap-{d}/ic_launcher.png')
EOF
"$BT/aapt2" compile --dir "$A/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest "$A/AndroidManifest.xml" -A "$A/assets" "$OUT/res.zip" \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" --java "$OUT/gen"
javac -nowarn -source 11 -target 11 -classpath "$JAR" -d "$OUT/classes" $(find "$A/src" "$OUT/gen" -name '*.java') 2>&1 | grep -v "warning" || true
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
cp "$OUT/base.apk" "$OUT/unaligned.apk"
(cd "$OUT/dex" && zip -q -j ../unaligned.apk classes.dex)
"$BT/zipalign" -p -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"
KS="$A/release.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias vistacoast -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "${KS_PASS:-vistacoast}" -keypass "${KS_PASS:-vistacoast}" -dname "CN=VISTA COAST, O=VISTA COAST, C=JP" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-key-alias vistacoast --ks-pass "pass:${KS_PASS:-vistacoast}" --key-pass "pass:${KS_PASS:-vistacoast}" \
  --out "$OUT/VISTA-COAST.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs "$OUT/VISTA-COAST.apk" | head -3
ls -la "$OUT/VISTA-COAST.apk"
