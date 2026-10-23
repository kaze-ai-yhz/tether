#!/usr/bin/env bash
# Export the live app views to the app's fixture files (app/web/src/fixtures/), for fixtures mode.
#
#   bash scripts/export_fixtures.sh
#
# One file per source, each {"_source": "live-export @ <ISO timestamp>", "rows": [...]}: the rows the app
# reads in live mode (src/lib/data.ts), in the same order, with lower-case keys and VARIANT/ARRAY/OBJECT
# columns as real JSON. Read only: nothing is written to Snowflake. Uses the Snowflake CLI connection
# "hackathon" (override with TETHER_SNOW_CONNECTION); credentials stay in the CLI config.
# Files are written to a temp dir first and moved into place only when every export succeeded.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONN="${TETHER_SNOW_CONNECTION:-hackathon}"
OUT="$ROOT/app/web/src/fixtures"
S="CARE_RULES.CORE"
ISO_TS="'YYYY-MM-DD\"T\"HH24:MI:SS.FF3'"

command -v snow >/dev/null || { echo "export_fixtures: snow CLI not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "export_fixtures: jq not found" >&2; exit 1; }
[ -d "$OUT" ] || { echo "export_fixtures: $OUT does not exist" >&2; exit 1; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/tether-fixtures.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
STAMP="$(date +%Y-%m-%dT%H:%M:%S%z)"

# file name | FROM clause | ORDER BY inside ARRAY_AGG | select list (default *)
# The whole result is aggregated into one JSON array so the row order is kept exactly.
EXPORTS=(
  "v_app_state|$S.V_APP_STATE|as_of_date|*"
  "v_queue|$S.V_QUEUE|is_red_flag DESC, priority, action_id|*"
  "v_held|$S.V_HELD|held_until, patient_id|*"
  "v_patient_list|$S.V_PATIENT_LIST|status_rank, patient_id|*"
  "v_patient_detail|$S.V_PATIENT_DETAIL|patient_id|*"
  "v_timeline|$S.V_TIMELINE|patient_id, logged_at DESC|*"
  "v_rules|$S.V_RULES|condition, priority, rule_id|*"
  "rule_edits|(SELECT edit_id, rule_id, field, old_value, new_value, reason, edited_by, TO_VARCHAR(edited_at, $ISO_TS) AS edited_at, impact FROM $S.RULE_EDITS ORDER BY edited_at DESC, edit_id DESC LIMIT 50)|edited_at DESC, edit_id DESC|*"
  "override_keys|$S.OVERRIDE_KEYS|setting|*"
  "safety_locked_terms|$S.SAFETY_LOCKED_TERMS|term|term"
  "ask_cache|(SELECT question, answer, TO_VARCHAR(recorded_at, $ISO_TS) AS recorded_at FROM $S.ASK_CACHE)|recorded_at DESC|*"
)

for spec in "${EXPORTS[@]}"; do
  IFS='|' read -r name from order cols <<<"$spec"
  if [ "$cols" = "*" ]; then obj="OBJECT_CONSTRUCT_KEEP_NULL(*)"; else obj="OBJECT_CONSTRUCT_KEEP_NULL('$cols', $cols)"; fi
  sql="SELECT TO_JSON(ARRAY_AGG($obj) WITHIN GROUP (ORDER BY $order)) AS J FROM $from"
  printf '%s\n' "$sql" >"$TMP/$name.sql"
  if ! snow sql -c "$CONN" --format json -f "$TMP/$name.sql" >"$TMP/$name.raw" 2>"$TMP/$name.err"; then
    echo "export_fixtures: $name failed:" >&2
    sed -n '1,20p' "$TMP/$name.err" >&2
    exit 1
  fi
  # The CLI returns the JSON text in column J; parse it and lower-case the top-level keys.
  jq --arg src "live-export @ $STAMP" \
     '{_source: $src, rows: ((.[0].J // "[]") | fromjson | map(with_entries(.key |= ascii_downcase)))}' \
     "$TMP/$name.raw" >"$TMP/$name.json"
  printf '  %-20s %5s rows\n' "$name" "$(jq '.rows | length' "$TMP/$name.json")"
done

for spec in "${EXPORTS[@]}"; do
  name="${spec%%|*}"
  mv "$TMP/$name.json" "$OUT/$name.json"
done
echo "export_fixtures: wrote ${#EXPORTS[@]} files to app/web/src/fixtures (_source: live-export @ $STAMP)"
