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
report() { curl -sf -H "x-apikey: $VT_API_KEY" "https://www.virustotal.com/api/v3/files/$SHA" || true; }
scanned() { echo "$1" | jq -e '.data.attributes.last_analysis_stats | (.malicious + .suspicious + .undetected + .harmless) > 0' >/dev/null 2>&1; }
# Already scanned (e.g. a second run on the same file)? Use that report.
JSON=$(report)
if ! scanned "$JSON"; then
  # Files over 32 MB need a one-off upload URL. Retry, since the free API
  # allows only 4 requests a minute.
  for i in 1 2 3; do
    URL=$(curl -sf -H "x-apikey: $VT_API_KEY" https://www.virustotal.com/api/v3/files/upload_url | jq -r .data) &&
      curl -sf -H "x-apikey: $VT_API_KEY" -F "file=@$F" "$URL" >/dev/null && UP=1 && break
    echo "Upload failed, retrying in 60s..." >&2; sleep 60
  done
  [ -n "$UP" ] || { echo "Upload to VirusTotal failed." >&2; exit 1; }
fi
# Wait for the scan to finish (up to ~15 min), then print the result.
for i in $(seq 30); do
  scanned "$JSON" || { sleep 30; JSON=$(report); }
  STATS=$(echo "$JSON" | jq -c .data.attributes.last_analysis_stats 2>/dev/null || true)
  BAD=$(echo "$STATS" | jq '(.malicious // 0) + (.suspicious // 0)' 2>/dev/null || true)
  TOTAL=$(echo "$STATS" | jq '(.malicious // 0) + (.suspicious // 0) + (.undetected // 0) + (.harmless // 0)' 2>/dev/null || true)
  SKIP=$(echo "$STATS" | jq '(.timeout // 0) + (."confirmed-timeout" // 0) + (.failure // 0)' 2>/dev/null || true)
  [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ] && break
done
URL="https://www.virustotal.com/gui/file/$SHA"
MS=$(echo "$JSON" | jq -r '.data.attributes.last_analysis_results.Microsoft | .result // ({"undetected":"clean","harmless":"clean","type-unsupported":"not scanned"}[.category]) // "-"' 2>/dev/null || echo -)
if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
  [ "$BAD" = 0 ] && ICON=✅ || ICON=⚠️
  # Engines that time out or error are not passes, so show them as skipped.
  [ -n "$SKIP" ] && [ "$SKIP" -gt 0 ] && SKIPPED=", $SKIP skipped" || SKIPPED=
  DET="$ICON $BAD / $TOTAL$SKIPPED"
else
  DET="still scanning"
fi
echo "**SHA-256:** \`$SHA\`"
echo
echo "## VirusTotal"
echo
echo "| File | Flagged by | Microsoft Defender | Full results |"
echo "|---|---|---|---|"
echo "| \`$(basename "$F")\` | $DET | $MS | [report]($URL) |"
echo
echo "Engines that did not finish in time are counted as skipped."
