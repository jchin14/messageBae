#!/bin/sh
# Upload a build to VirusTotal and print its SHA-256 and report link,
# for the GitHub release notes. Key: VT_API_KEY, or the keychain item
# "virustotal" (security add-generic-password -a "$USER" -s virustotal -w <key>).
# Usage: npm run virustotal [file]   (default: newest dist/*.dmg)
set -e
F=${1:-$(ls -t dist/*.dmg | head -1)}
VT_API_KEY=${VT_API_KEY:-$(security find-generic-password -s virustotal -w 2>/dev/null || true)}
[ -n "$VT_API_KEY" ] || { echo "No VirusTotal key (VT_API_KEY or keychain item virustotal)."; exit 1; }
SHA=$(shasum -a 256 "$F" | cut -d' ' -f1)
# Files over 32 MB need a one-off upload URL.
URL=$(curl -sf -H "x-apikey: $VT_API_KEY" https://www.virustotal.com/api/v3/files/upload_url | jq -r .data)
curl -sf -H "x-apikey: $VT_API_KEY" -F "file=@$F" "$URL" >/dev/null
echo "SHA-256: $SHA"
echo "https://www.virustotal.com/gui/file/$SHA"
