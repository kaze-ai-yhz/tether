#!/usr/bin/env bash
# Run Tether SQL with the Snowflake CLI (connection "hackathon").
#
#   bash scripts/run_sql.sh            Faiz's base file, then every sql/[1-9][0-9]_*.sql in numeric order
#   bash scripts/run_sql.sh FILE...    only these files, in the order given
#
# Faiz's file (sql/care_rules_snowflake.sql) runs unchanged, in two parts split at the line
# "CALL GENERATE_DRAFTS();":
#   part 1  line 1 through the SELECT that follows that CALL, in one session so SET CLAUDE_MODEL is
#           in scope. A failure is tolerated only when the failing statement is that CALL and
#           GENERATE_DRAFTS and V_RULE_FIRINGS exist (Tether drafts with its own procedure).
#   part 2  the rest of the file, in a session whose current schema is CARE_RULES.CORE (the file's
#           own USE SCHEMA sits in part 1); it must succeed.
# If the file has no such line (for example after Faiz adopts the fix in docs/tether/PROPOSED-CHANGES.md),
# it runs whole, in one session, and must succeed.
# Before the base file runs, AUDIT_LOG rows are copied to AUDIT_ARCHIVE (when both tables exist),
# because the base file recreates AUDIT_LOG. After it, the Tether tables keyed on ACTION_QUEUE ids are
# truncated, because the base file restarts those ids at 1, and the reload is written to AUDIT_LOG.
# Every other file runs with CARE_RULES.CORE as the current schema and stops the run at its first error.
#
# Logs: $TMPDIR/tether-run-sql/<run>/. VERBOSE=1 streams the CLI output. Credentials stay in the CLI
# connection config; this script never reads or prints them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONN="${TETHER_SNOW_CONNECTION:-hackathon}"
SCHEMA="CARE_RULES.CORE"
BASE_REL="sql/care_rules_snowflake.sql"
SPLIT_LINE='CALL GENERATE_DRAFTS();'
TRUNCATE_AFTER_BASE="ACTION_META OUTBOX CALL_TRANSCRIPTS DRAFT_STAGE CARE_PLANS TODOS"

LOG_ROOT="${TMPDIR:-/tmp}"
LOG_DIR="${LOG_ROOT%/}/tether-run-sql/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$LOG_DIR"

ARCHIVED=0
RESET_ID=""
DRAFTS_NOTE="GENERATE_DRAFTS not run"

say() { printf '%s\n' "$*"; }
die() { printf 'run_sql: %s\n' "$*" >&2; exit 1; }

# The CLI's boxed error message (stderr) as one line.
error_text() {
  perl -CSD -0777 -pe 's/[\x{2500}-\x{257F}]//g; s/^\s*Error\s*//; s/\s+/ /g; s/^\s+|\s+$//g' "$1"
}

# The statement the CLI echoed last without a result table after it, i.e. the one that failed.
last_statement() {
  awk '/^\+[-+]+\+$/ { buf = ""; next } NF { buf = buf $0 "\n" } END { printf "%s", buf }' "$1" |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

statement_count() {
  awk '/^\+[-+]+\+$/ { n++ } END { print int(n / 2) }' "$1"
}

report_failure() {
  local label="$1"
  say "  failed statement:"
  last_statement "$LOG_DIR/$label.out" | sed 's/^/    /'
  say "  error: $(error_text "$LOG_DIR/$label.err")"
  say "  log: $LOG_DIR/$label.out"
}

# One statement, JSON result on stdout; a failure prints the error and returns non-zero.
sf_json() {
  local label="$1" sql="$2"
  if ! snow sql -c "$CONN" --format json -q "$sql" >"$LOG_DIR/$label.json" 2>"$LOG_DIR/$label.err"; then
    say "  query failed ($label): $(error_text "$LOG_DIR/$label.err")" >&2
    return 1
  fi
  cat "$LOG_DIR/$label.json"
}

# One file in one session; output in $LOG_DIR/<label>.out and .err. Extra arguments go to the CLI.
run_file() {
  local label="$1" file="$2" rc=0
  shift 2
  if [[ "${VERBOSE:-0}" == 1 ]]; then
    snow sql -c "$CONN" "$@" -f "$file" 2>"$LOG_DIR/$label.err" | tee "$LOG_DIR/$label.out" || rc=$?
  else
    snow sql -c "$CONN" "$@" -f "$file" >"$LOG_DIR/$label.out" 2>"$LOG_DIR/$label.err" || rc=$?
  fi
  return "$rc"
}

# Session context for everything after the base file's own USE SCHEMA (which only part 1 sees).
IN_SCHEMA_ARGS="--database CARE_RULES --schema CORE"

object_exists() {  # SHOW kind (PROCEDURES | VIEWS | TABLES), object name
  local out
  out="$(sf_json "exists_$2" "SHOW $1 LIKE '$2' IN SCHEMA $SCHEMA")" || return 1
  [[ "$(jq 'length' <<<"$out")" -gt 0 ]]
}

archive_audit() {
  local out n
  out="$(sf_json db_check "SHOW DATABASES LIKE 'CARE_RULES'")"
  if [[ "$(jq 'length' <<<"$out")" -eq 0 ]]; then
    say "  audit archive: skipped (database CARE_RULES does not exist yet)"
    return 0
  fi
  out="$(sf_json audit_tables "SELECT COUNT(*) AS N FROM CARE_RULES.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'CORE' AND TABLE_NAME IN ('AUDIT_LOG', 'AUDIT_ARCHIVE')")"
  n="$(jq '.[0].N' <<<"$out")"
  if [[ "$n" -ne 2 ]]; then
    say "  audit archive: skipped (AUDIT_LOG or AUDIT_ARCHIVE does not exist yet)"
    return 0
  fi
  RESET_ID="$(uuidgen | tr 'A-Z' 'a-z')"
  [[ "$RESET_ID" =~ ^[0-9a-f-]{36}$ ]] || die "unexpected uuidgen output"
  out="$(sf_json audit_archive "INSERT INTO $SCHEMA.AUDIT_ARCHIVE (reset_id, archived_at, logged_at, actor, event, action_id, detail) SELECT '$RESET_ID', CURRENT_TIMESTAMP(), logged_at, actor, event, action_id, detail FROM $SCHEMA.AUDIT_LOG")"
  ARCHIVED="$(jq '.[0]["number of rows inserted"]' <<<"$out")"
  say "  audit archive: $ARCHIVED AUDIT_LOG rows copied to AUDIT_ARCHIVE (reset $RESET_ID)"
}

after_base() {
  local sql="" t detail
  for t in $TRUNCATE_AFTER_BASE; do
    sql="${sql}TRUNCATE TABLE IF EXISTS $SCHEMA.$t; "
  done
  detail="Base file reloaded; $ARCHIVED audit rows archived${RESET_ID:+ (reset $RESET_ID)}; $DRAFTS_NOTE; truncated $(printf '%s' "$TRUNCATE_AFTER_BASE" | tr ' ' ',')"
  detail="${detail//\'/\'\'}"
  sql="${sql}INSERT INTO $SCHEMA.AUDIT_LOG (actor, event, detail) VALUES ('scripts/run_sql.sh', 'BASE_RELOADED', '$detail');"
  if ! snow sql -c "$CONN" -q "$sql" >"$LOG_DIR/after_base.out" 2>"$LOG_DIR/after_base.err"; then
    report_failure after_base
    die "post-base truncate and audit failed"
  fi
  say "  truncated (ids restart with ACTION_QUEUE): $TRUNCATE_AFTER_BASE"
  say "  audited: BASE_RELOADED"
}

run_base() {
  local file="$ROOT/$BASE_REL" count call_ln end_ln start last gd_error db_status n
  say "==> $BASE_REL (Faiz, unchanged)"
  archive_audit

  count="$(grep -c -x -F "$SPLIT_LINE" "$file" || true)"
  if [[ "$count" -eq 0 ]]; then
    # The file no longer has the failing CALL line: run it whole, in one session; it must succeed.
    say "  no line '$SPLIT_LINE': running the whole file in one session"
    start=$SECONDS
    if ! run_file base_part1 "$file"; then
      report_failure base_part1
      die "$BASE_REL failed"
    fi
    n="$(sf_json faiz_drafts "SELECT COUNT(*) AS N FROM $SCHEMA.ACTION_QUEUE" | jq '.[0].N')"
    DRAFTS_NOTE="ACTION_QUEUE has $n rows after the base file"
    say "  $DRAFTS_NOTE (kept)"
    say "  done ($((SECONDS - start)) s, $(statement_count "$LOG_DIR/base_part1.out") statements)"
    after_base
    return 0
  fi
  [[ "$count" -eq 1 ]] || die "expected at most one line '$SPLIT_LINE' in $BASE_REL, found $count"
  call_ln="$(grep -n -x -F "$SPLIT_LINE" "$file" | cut -d: -f1)"
  # Part 1 ends with the SELECT statement right after the CALL (blank and comment lines may sit between).
  end_ln="$(awk -v c="$call_ln" '
    NR <= c { next }
    !started && /^[[:space:]]*(--.*)?$/ { next }
    !started { if ($0 !~ /^[[:space:]]*SELECT[[:space:]]/) exit; started = 1 }
    started && /;[[:space:]]*$/ { print NR; exit }' "$file")"
  [[ -n "$end_ln" ]] || die "no SELECT statement right after '$SPLIT_LINE' in $BASE_REL"
  sed -n "1,${end_ln}p" "$file" >"$LOG_DIR/base_part1.sql"
  sed -n "$((end_ln + 1)),\$p" "$file" >"$LOG_DIR/base_part2.sql"

  say "  part 1: lines 1-$end_ln (through the SELECT after line $call_ln '$SPLIT_LINE')"
  start=$SECONDS
  if run_file base_part1 "$LOG_DIR/base_part1.sql"; then
    n="$(sf_json faiz_drafts "SELECT COUNT(*) AS N FROM $SCHEMA.ACTION_QUEUE" | jq '.[0].N')"
    DRAFTS_NOTE="GENERATE_DRAFTS created $n drafts"
    say "  $DRAFTS_NOTE (Faiz's drafts are kept)"
  else
    last="$(last_statement "$LOG_DIR/base_part1.out")"
    if [[ "$last" == "$SPLIT_LINE" ]] && object_exists PROCEDURES GENERATE_DRAFTS && object_exists VIEWS V_RULE_FIRINGS; then
      gd_error="$(error_text "$LOG_DIR/base_part1.err")"
      DRAFTS_NOTE="GENERATE_DRAFTS failed (tolerated)"
      say "  CALL GENERATE_DRAFTS() failed; tolerated (GENERATE_DRAFTS and V_RULE_FIRINGS exist)."
      say "  error: $gd_error"
    else
      report_failure base_part1
      die "$BASE_REL part 1 failed before '$SPLIT_LINE'"
    fi
  fi
  db_status="$(awk '/^CREATE DATABASE/ { f = 1; next }
    f && /^\|/ && !/^\|-/ && !/\| status/ { sub(/^\| */, ""); sub(/ *\|$/, ""); print; exit }' "$LOG_DIR/base_part1.out")"
  say "  CREATE DATABASE: ${db_status:-no status captured}"
  say "  part 1 done ($((SECONDS - start)) s, $(statement_count "$LOG_DIR/base_part1.out") statements ran)"

  say "  part 2: lines $((end_ln + 1))-end"
  start=$SECONDS
  # shellcheck disable=SC2086  # IN_SCHEMA_ARGS is a fixed list of words
  if ! run_file base_part2 "$LOG_DIR/base_part2.sql" $IN_SCHEMA_ARGS; then
    report_failure base_part2
    die "$BASE_REL part 2 failed"
  fi
  say "  part 2 done ($((SECONDS - start)) s, $(statement_count "$LOG_DIR/base_part2.out") statements)"
  after_base
}

run_other() {
  local abs="$1" rel label start
  rel="${abs#"$ROOT"/}"
  label="$(basename "$abs" .sql)"
  say "==> $rel"
  start=$SECONDS
  # shellcheck disable=SC2086  # IN_SCHEMA_ARGS is a fixed list of words
  if ! run_file "$label" "$abs" $IN_SCHEMA_ARGS; then
    report_failure "$label"
    die "$rel failed"
  fi
  say "  ok ($((SECONDS - start)) s, $(statement_count "$LOG_DIR/$label.out") statements)"
}

abs_path() {
  local dir
  dir="$(cd "$(dirname "$1")" 2>/dev/null && pwd)" || return 1
  printf '%s/%s\n' "$dir" "$(basename "$1")"
}

main() {
  local files=() f p
  command -v snow >/dev/null || die "Snowflake CLI 'snow' not found"
  command -v jq >/dev/null || die "jq not found"
  if [[ $# -eq 0 ]]; then
    files+=("$ROOT/$BASE_REL")
    for f in "$ROOT"/sql/[1-9][0-9]_*.sql; do
      if [[ -e "$f" ]]; then files+=("$f"); fi
    done
  else
    for f in "$@"; do
      p="$(abs_path "$f")" && [[ -f "$p" ]] || die "file not found: $f"
      files+=("$p")
    done
  fi
  say "run_sql: connection '$CONN', ${#files[@]} file(s), logs in $LOG_DIR"
  for f in "${files[@]}"; do
    if [[ "$f" == "$ROOT/$BASE_REL" ]]; then
      run_base
    else
      run_other "$f"
    fi
  done
  say "run_sql: done"
}

main "$@"
