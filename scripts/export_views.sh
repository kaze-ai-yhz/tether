#!/usr/bin/env bash
# Re-save the app's export files (EXPORT_VIEWS in app/web/.env.local) from live Snowflake, after
# rebuilding the patient snapshots. Run it after a reset made outside the app; the app re-saves
# the files itself after every write. Needs the app running (default http://localhost:3000).
set -euo pipefail
APP_URL="${APP_URL:-http://localhost:3000}"
curl -sS --max-time 300 -X POST "$APP_URL/api/export" \
  -H "Content-Type: application/json" -d '{"rebuildSnapshots":true}'
echo
