#!/bin/bash
# Build the signed release APK. The upload keystore lives outside the repo at
# ~/.android-keystores/atlas-release.jks and its password is read from the macOS Keychain
# (service "atlas-android-keystore", account "atlas-release"). Nothing secret is written to disk.
#
#   bash mobile/android/scripts/release.sh            # assembleRelease
#   bash mobile/android/scripts/release.sh assembleRelease testReleaseUnitTest
set -euo pipefail
cd "$(dirname "$0")/.."
# Gradle 8.14 does not run on JDK 25, so prefer Homebrew's JDK 21 when it is installed.
if [ -d /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
fi
pw="$(security find-generic-password -s atlas-android-keystore -a atlas-release -w)"
if [ -z "$pw" ]; then echo "No keystore password in the Keychain." >&2; exit 1; fi
export ATLAS_KEYSTORE_PATH="$HOME/.android-keystores/atlas-release.jks"
export ATLAS_KEYSTORE_PASSWORD="$pw"
export ATLAS_KEY_ALIAS=atlas
if [ "$#" -eq 0 ]; then set -- assembleRelease; fi
./gradlew --console=plain "$@"
