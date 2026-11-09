#!/bin/sh
# Notarize the DMG itself and staple the ticket to it, so macOS can
# verify it offline. (electron-builder only notarizes the app inside.)
# Usage: npm run staple [file]   (default: newest dist/*.dmg)
set -e
F=${1:-$(ls -t dist/*.dmg | head -1)}
xcrun notarytool submit "$F" --keychain-profile "${APPLE_KEYCHAIN_PROFILE:-messagebae}" --wait
xcrun stapler staple "$F"
xcrun stapler validate "$F"
