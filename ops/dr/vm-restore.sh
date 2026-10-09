#!/usr/bin/env bash
# Vialabote DR — restore pipeline INSIDE vialabote-dr (root).
#
#   verify  <set-id>   copy from /srv/dr-inbox (READY marker required) -> check
#                      CIPHER.sha256 -> decrypt (DR key) -> check plaintext sha256
#                      (manifest) -> scratch-restore each DB, compare per-table row
#                      counts with the manifest -> uploads: extract to scratch and
#                      check every file's sha256 -> release commits vs deployed
#                      -> status VERIFIED | REJECTED (+ reasons); scratch + plaintext removed
#   promote <set-id> [--allow-test] [--with-secrets]
#                      only a VERIFIED set; TEST sets only with --allow-test.
#                      stop standby units -> restore both DBs into the standby DBs
#                      (owned by the *_owner roles, DML for *_app via default privileges)
#                      -> swap uploads (old kept aside) -> optional env merge from the
#                      secrets artifact (DB URLs stay DR-local) -> start units -> smoke
#                      -> CURRENT -> <set-id>
#   status             list sets and their verdicts
set -euo pipefail
export LC_ALL=C
CMD=${1:?verify|promote|status}; ID=${2:-}
INBOX=/srv/dr-inbox/sets
BASE=/var/lib/vialabote-dr
export GNUPGHOME=/etc/vialabote-dr/gnupg
RUNUSER=/usr/sbin/runuser
die() { echo "ABORT: $*" >&2; exit 1; }
pg() { "$RUNUSER" -u postgres -- psql -X -At -v ON_ERROR_STOP=1 -p "$1" -d "${2:-postgres}" -c "$3"; }
port_of() { [ "$1" = site1 ] && echo 5432 || echo 5433; }
counts_json() {
  local q="select string_agg(format('\"%s\":%s', relname, n), ',' order by relname) from (select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='public') t"
  echo "{$(pg "$1" "$2" "$q")}"
}
decrypt_set() {  # id -> $BASE/restore/<id> (0700)
  local id=$1 d=$BASE/sets/$1 r=$BASE/restore/$1
  install -d -m 0700 "$r"
  for f in "$d"/*.gpg; do gpg --batch --quiet --decrypt --output "$r/$(basename "$f" .gpg)" "$f"; done
}
wipe_plain() { [ -d "$BASE/restore/$1" ] && find "$BASE/restore/$1" -type f -exec shred -u {} + 2>/dev/null; rm -rf "$BASE/restore/$1"; }

case "$CMD" in
status)
  for s in "$BASE"/status/*.json; do [ -f "$s" ] && python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["set"],d["verdict"],d.get("label"),d.get("verified_at"),";".join(d.get("reasons",[])))' "$s"; done
  echo "CURRENT=$(readlink "$BASE/CURRENT" 2>/dev/null || echo none)"; exit 0;;
verify)
  [ -n "$ID" ] || die "set id"
  [ -f "$INBOX/$ID.READY" ] || die "set $ID not READY in inbox (transfer incomplete)"
  rsync -a --delete "$INBOX/$ID/" "$BASE/sets/$ID/"
  REASONS=(); OUT=$BASE/status/$ID.json
  if ! (cd "$BASE/sets/$ID" && [ -s CIPHER.sha256 ] && sha256sum -c --quiet CIPHER.sha256); then REASONS+=("cipher checksum mismatch"); fi
  if [ ${#REASONS[@]} -eq 0 ]; then
    decrypt_set "$ID" || REASONS+=("decryption failed")
  fi
  R=$BASE/restore/$ID
  CHECKS=$(mktemp)
  if [ ${#REASONS[@]} -eq 0 ]; then
    python3 - "$R" > "$CHECKS" <<'PY' || true
import hashlib, json, os, sys
r = sys.argv[1]; m = json.load(open(os.path.join(r, "manifest.json")))
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()
for name, want in m["artifacts_sha256"].items():
    if name == "manifest.json": continue
    p = os.path.join(r, name)
    print("PLAIN", name, "ok" if os.path.exists(p) and sha(p) == want else "MISMATCH")
PY
    grep -q MISMATCH "$CHECKS" && REASONS+=("plaintext sha256 mismatch: $(grep MISMATCH "$CHECKS" | awk '{print $2}' | tr '\n' ' ')")
    for site in site1 site2; do
      [ -f "$R/$site.dump" ] || continue
      P=$(port_of $site); SDB=dr_scratch_${site}
      pg "$P" postgres "drop database if exists $SDB" >/dev/null; pg "$P" postgres "create database $SDB" >/dev/null
      # root opens the dump (restore dir is 0700 root) and streams it to pg_restore
      if ! "$RUNUSER" -u postgres -- pg_restore -p "$P" -d "$SDB" --no-owner --no-privileges --exit-on-error < "$R/$site.dump" 2>"$R/$site.restore.err"; then
        REASONS+=("$site pg_restore failed"); sed 's/^/    pg_restore: /' "$R/$site.restore.err" | tail -5
      fi
      GOT=$(counts_json "$P" "$SDB")
      python3 - "$R/manifest.json" "$site" "$GOT" <<'PY' || REASONS+=("$site row counts differ")
import json, sys
m = json.load(open(sys.argv[1])); want = m["row_counts"].get(sys.argv[2], {}); got = json.loads(sys.argv[3])
bad = {t: (want[t], got.get(t)) for t in want if want[t] != got.get(t)}
print(f"  {sys.argv[2]}: {len(want)} tables, {sum(want.values())} rows expected, mismatches={bad or 'none'}")
sys.exit(1 if bad else 0)
PY
      pg "$P" postgres "drop database $SDB" >/dev/null
    done
    for site in site1 site2; do
      [ -f "$R/$site-uploads.tar" ] || continue
      U=$R/$site-uploads; mkdir -p "$U"; tar -C "$U" -xf "$R/$site-uploads.tar"
      (cd "$U" && sha256sum -c --quiet "$R/$site-uploads.files.sha256") || REASONS+=("$site uploads content mismatch")
      echo "  $site uploads: $(wc -l < "$R/$site-uploads.files.sha256") files checked"
    done
    for site in site1 site2; do
      WANT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["release_commits"].get(sys.argv[2],""))' "$R/manifest.json" "$site")
      [ -n "$WANT" ] || continue
      OPT=$([ $site = site1 ] && echo /opt/vialabote || echo /opt/vialabote-shop)
      HAVE=$(cat "$OPT/current/.release-commit" 2>/dev/null || basename "$(readlink -f "$OPT/current")")
      case "$WANT" in "$HAVE"*|"${HAVE:0:7}"*) echo "  $site release commit matches deployed ($HAVE)";; *) echo "  $site release commit in backup $WANT != deployed $HAVE (build that SHA before promote)";; esac
    done
  fi
  LABEL=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("label",""))' "$R/manifest.json" 2>/dev/null || echo "?")
  VERDICT=VERIFIED; [ ${#REASONS[@]} -eq 0 ] || VERDICT=REJECTED
  python3 - "$OUT" "$ID" "$VERDICT" "$LABEL" "${REASONS[@]}" <<'PY'
import json, sys, datetime
out, sid, verdict, label, *reasons = sys.argv[1:]
json.dump({"set": sid, "verdict": verdict, "label": label, "reasons": reasons,
           "verified_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}, open(out, "w"), indent=1)
PY
  wipe_plain "$ID"; rm -f "$CHECKS"
  echo "SET $ID: $VERDICT (label $LABEL)${REASONS:+ — ${REASONS[*]}}"
  [ "$VERDICT" = VERIFIED ];;
promote)
  [ -n "$ID" ] || die "set id"; shift 2
  ALLOW_TEST=0; WITH_SECRETS=0
  for a in "$@"; do case "$a" in --allow-test) ALLOW_TEST=1;; --with-secrets) WITH_SECRETS=1;; *) die "unknown flag $a";; esac; done
  S=$BASE/status/$ID.json; [ -f "$S" ] || die "set $ID never verified"
  read -r VERDICT LABEL < <(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["verdict"],d["label"])' "$S")
  [ "$VERDICT" = VERIFIED ] || die "set $ID is $VERDICT — only VERIFIED sets can be promoted"
  [ "$LABEL" = PROD ] || [ "$ALLOW_TEST" = 1 ] || die "set $ID is $LABEL — pass --allow-test to promote a TEST set"
  (cd "$BASE/sets/$ID" && sha256sum -c --quiet CIPHER.sha256) || die "cipher checksum changed since verification"
  decrypt_set "$ID"; R=$BASE/restore/$ID; STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  systemctl stop vialabote-site.service vialabote-shop.service
  for site in site1 site2; do
    [ -f "$R/$site.dump" ] || continue
    P=$(port_of $site); DB=$([ $site = site1 ] && echo vialabote_site || echo vialabote_shop); OWN=${DB}_owner
    pg "$P" postgres "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DB'" >/dev/null
    pg "$P" postgres "alter database $DB rename to ${DB}_pre_$STAMP" >/dev/null
    pg "$P" postgres "create database $DB owner $OWN encoding 'UTF8' template template0" >/dev/null
    pg "$P" "$DB" "revoke all on schema public from public; alter schema public owner to $OWN; grant usage on schema public to ${DB}_app; alter default privileges for role $OWN in schema public grant select, insert, update, delete on tables to ${DB}_app; alter default privileges for role $OWN in schema public grant usage, select on sequences to ${DB}_app" >/dev/null
    pg "$P" postgres "revoke all on database $DB from public; grant connect, temporary on database $DB to ${DB}_app" >/dev/null
    "$RUNUSER" -u postgres -- pg_restore -p "$P" -d "$DB" --no-owner --no-privileges --role="$OWN" --exit-on-error < "$R/$site.dump"
    echo "  $site: restored into $DB (previous kept as ${DB}_pre_$STAMP)"
  done
  for site in site1 site2; do
    [ -f "$R/$site-uploads.tar" ] || continue
    SH=$([ $site = site1 ] && echo /opt/vialabote/shared || echo /opt/vialabote-shop/shared); OWNU=$([ $site = site1 ] && echo vialabote || echo vialabote-shop)
    mv "$SH/uploads" "$SH/uploads.pre-$STAMP"; install -d -m 0750 -o "$OWNU" -g "$OWNU" "$SH/uploads"
    tar -C "$SH/uploads" -xf "$R/$site-uploads.tar"; chown -R "$OWNU:$OWNU" "$SH/uploads"
    echo "  $site: uploads restored (previous kept as uploads.pre-$STAMP)"
  done
  if [ "$WITH_SECRETS" = 1 ] && [ -f "$R/secrets.tar" ]; then
    echo "  --with-secrets: env merge is a failover-time step (Phase 8); not applied automatically in this version"
  fi
  systemctl start vialabote-site.service vialabote-shop.service
  for p in 3001 3002; do for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$p/)" != 000 ] && break; sleep 2; done; done
  H1=$(curl -s -o /dev/null -m 20 -w '%{http_code}' http://127.0.0.1:3001/); H2=$(curl -s -o /dev/null -m 20 -w '%{http_code}' http://127.0.0.1:3002/)
  wipe_plain "$ID"
  ln -sfn "sets/$ID" "$BASE/CURRENT"
  echo "$LABEL $ID promoted $(date -u +%FT%TZ)" > "$BASE/status/standby-data"
  echo "PROMOTED $ID ($LABEL): site1 :3001 -> $H1, site2 :3002 -> $H2"
  [ "$H1" = 200 ] && [ "$H2" = 200 ];;
*) die "unknown command $CMD";;
esac
