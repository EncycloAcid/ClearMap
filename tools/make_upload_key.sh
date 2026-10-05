#!/usr/bin/env bash
# Create the upload key that signs Clearway for Google Play, and android/keystore.properties pointing at it.
# Run once, on your own computer, and keep both files somewhere safe (a password manager or backup):
# with Play App Signing, Google can reset a lost upload key, but it takes days.
# Neither file is committed (see .gitignore).
set -euo pipefail
cd "$(dirname "$0")/../android"
if [ -e upload-key.jks ]; then echo "android/upload-key.jks already exists; not overwriting it." >&2; exit 1; fi
read -rsp "Choose a password for the upload key (at least 6 characters): " PW; echo
read -rp "Your name or organisation (shown in the certificate): " WHO
keytool -genkeypair -v -keystore upload-key.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PW" -keypass "$PW" -dname "CN=$WHO"
cat > keystore.properties <<EOF
storeFile=upload-key.jks
storePassword=$PW
keyAlias=upload
keyPassword=$PW
EOF
chmod 600 keystore.properties upload-key.jks
echo "Created android/upload-key.jks and android/keystore.properties."
echo "Now build the bundle: cd android && ./gradlew bundleRelease"
