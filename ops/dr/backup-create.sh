#!/usr/bin/env bash
# Vialabote DR — create one encrypted backup SET of all non-git state.
# Runs as root on the backup SOURCE: PRIMARY (label PROD, once it is reachable)
# or the DR VM itself as a stand-in (label TEST, pipeline tests only).
#
# A set contains (each GPG-encrypted to the DR key; plaintext never leaves this host):
#   site1.dump / site2.dump        pg_dump -Fc of the SITE_1 / SITE_2 databases
#   site1-uploads.tar / site2-...  uploads/media (+ inner sha256 file lists)
#   config.tar                     NON-secret config manifest: systemd units, nginx vhosts,
#                                  env KEY NAMES only, release commits, versions
#   secrets.tar                    env files with values (separate artifact; optional)
#   manifest.json                  sha256 of every plaintext artifact, per-table row counts,
#                                  file counts, release commits, label, timestamps
# plus CIPHER.sha256 (plaintext list of sha256 of the *.gpg files — no secrets).
# The set is built in .tmp-<id> and renamed into place atomically; a puller only
# ever sees complete sets. Code is NOT in the set: both sites build from git SHAs.
#
# usage: backup-create.sh --label TEST|PROD --recipient <pubkey.asc> --out <dir> [--keep N]
#          [--site1-db NAME --site1-port P --site1-uploads DIR --site1-release DIR --site1-env FILE...]
#          [--site2-db NAME --site2-port P --site2-uploads DIR --site2-release DIR --site2-env FILE...]
#          [--group G]  (group that may read finished sets, e.g. the pull user)
set -euo pipefail
export LC_ALL=C
die() { echo "ABORT: $*" >&2; exit 1; }
LABEL=""; RECIP=""; OUT=""; KEEP=3; GROUP=root
S1_DB=""; S1_PORT=5432; S1_UP=""; S1_REL=""; S1_ENV=()
S2_DB=""; S2_PORT=5433; S2_UP=""; S2_REL=""; S2_ENV=()
while [ $# -gt 0 ]; do case "$1" in
  --label) LABEL=$2; shift 2;; --recipient) RECIP=$2; shift 2;; --out) OUT=$2; shift 2;; --keep) KEEP=$2; shift 2;; --group) GROUP=$2; shift 2;;
  --site1-db) S1_DB=$2; shift 2;; --site1-port) S1_PORT=$2; shift 2;; --site1-uploads) S1_UP=$2; shift 2;; --site1-release) S1_REL=$2; shift 2;; --site1-env) S1_ENV+=("$2"); shift 2;;
  --site2-db) S2_DB=$2; shift 2;; --site2-port) S2_PORT=$2; shift 2;; --site2-uploads) S2_UP=$2; shift 2;; --site2-release) S2_REL=$2; shift 2;; --site2-env) S2_ENV+=("$2"); shift 2;;
  *) die "unknown arg $1";; esac; done
case "$LABEL" in TEST|PROD) ;; *) die "--label TEST|PROD";; esac
[ -f "$RECIP" ] && [ -n "$OUT" ] || die "--recipient and --out required"
[ "$(id -u)" -eq 0 ] || die "run as root"
RUNUSER=/usr/sbin/runuser
ID=$(date -u +%Y%m%dT%H%M%SZ)-$LABEL
TMP=$OUT/.tmp-$ID; PLAIN=$TMP/plain; SET=$TMP/set
umask 077; mkdir -p "$PLAIN" "$SET"
cleanup_plain() { find "$PLAIN" -type f -exec shred -u {} + 2>/dev/null || true; rmdir "$PLAIN" 2>/dev/null || true; }
trap 'cleanup_plain; [ -d "$TMP" ] && echo "set $ID left incomplete in $TMP (never published)" >&2' EXIT
export GNUPGHOME=$TMP/.gnupg; mkdir -p "$GNUPGHOME"
gpg --batch --quiet --import "$RECIP"
FPR=$(gpg --batch --with-colons --list-keys | awk -F: '/^fpr/{print $10; exit}')
[ -n "$FPR" ] || die "recipient key unreadable"

pgq() { "$RUNUSER" -u postgres -- psql -X -At -v ON_ERROR_STOP=1 -p "$1" -d "$2" -c "$3"; }
counts_json() {  # port db -> {"table":rows,...}
  local q="select string_agg(format('\"%s\":%s', relname, n), ',' order by relname) from (select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='public') t"
  echo "{$(pgq "$1" "$2" "$q")}"
}
dump_site() {  # tag port db
  local tag=$1 port=$2 db=$3
  "$RUNUSER" -u postgres -- pg_dump -p "$port" -Fc --no-owner --no-privileges -d "$db" > "$PLAIN/$tag.dump"
  pg_restore --list "$PLAIN/$tag.dump" >/dev/null   # dump must be readable
  counts_json "$port" "$db" > "$PLAIN/$tag.counts.json"
}
pack_uploads() {  # tag dir
  local tag=$1 dir=$2
  (cd "$dir" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$PLAIN/$tag-uploads.files.sha256"
  tar -C "$dir" -cf "$PLAIN/$tag-uploads.tar" .
}
release_commit() {  # release dir -> commit
  local d; d=$(readlink -f "$1"); cat "$d/.release-commit" 2>/dev/null || basename "$d"
}

S1_COMMIT=""; S2_COMMIT=""
[ -n "$S1_DB" ] && dump_site site1 "$S1_PORT" "$S1_DB"
[ -n "$S2_DB" ] && dump_site site2 "$S2_PORT" "$S2_DB"
[ -n "$S1_UP" ] && pack_uploads site1 "$S1_UP"
[ -n "$S2_UP" ] && pack_uploads site2 "$S2_UP"
[ -n "$S1_REL" ] && S1_COMMIT=$(release_commit "$S1_REL")
[ -n "$S2_REL" ] && S2_COMMIT=$(release_commit "$S2_REL")

# NON-secret config manifest
CFG=$PLAIN/config; mkdir -p "$CFG"
for u in vialabote-site vialabote-shop; do systemctl cat "$u.service" > "$CFG/$u.service.txt" 2>/dev/null || true; done
cp -L /etc/nginx/sites-enabled/* "$CFG/" 2>/dev/null || true
for f in "${S1_ENV[@]}" "${S2_ENV[@]}"; do [ -f "$f" ] && sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$f" > "$CFG/$(echo "$f" | tr / _).keys"; done
{ echo "postgres $(psql --version | awk '{print $3}')"; echo "site1_commit $S1_COMMIT"; echo "site2_commit $S2_COMMIT"; echo "host $(hostname)"; } > "$CFG/versions.txt"
tar -C "$PLAIN" -cf "$PLAIN/config.tar" config && find "$CFG" -type f -exec shred -u {} + && rmdir "$CFG"
# secrets (values) as a separate artifact
if [ ${#S1_ENV[@]} -gt 0 ] || [ ${#S2_ENV[@]} -gt 0 ]; then tar -cf "$PLAIN/secrets.tar" -P "${S1_ENV[@]}" "${S2_ENV[@]}" 2>/dev/null; fi

# manifest (plaintext sha256 + counts)
python3 - "$PLAIN" "$ID" "$LABEL" "$S1_DB" "$S2_DB" "$S1_COMMIT" "$S2_COMMIT" > "$PLAIN/manifest.json" <<'PY'
import hashlib, json, os, sys
plain, sid, label, s1db, s2db, s1c, s2c = sys.argv[1:8]
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()
arts = {f: sha(os.path.join(plain, f)) for f in sorted(os.listdir(plain)) if not f.endswith(".counts.json")}
counts = {}
for t in ("site1", "site2"):
    p = os.path.join(plain, t + ".counts.json")
    if os.path.exists(p): counts[t] = json.load(open(p))
files = {}
for t in ("site1", "site2"):
    p = os.path.join(plain, t + "-uploads.files.sha256")
    if os.path.exists(p): files[t] = sum(1 for _ in open(p))
print(json.dumps({"set": sid, "label": label, "artifacts_sha256": arts, "row_counts": counts,
                  "upload_file_counts": files, "databases": {"site1": s1db, "site2": s2db},
                  "release_commits": {"site1": s1c, "site2": s2c}, "format": 1}, indent=1, sort_keys=True))
PY
rm -f "$PLAIN"/*.counts.json

# encrypt everything to the DR key
for f in "$PLAIN"/*; do
  gpg --batch --quiet --trust-model always --recipient "$FPR" --output "$SET/$(basename "$f").gpg" --encrypt "$f"
done
(cd "$SET" && sha256sum *.gpg > CIPHER.sha256)
cleanup_plain
chgrp -R "$GROUP" "$SET"; chmod 0750 "$SET"; chmod 0640 "$SET"/*
mv "$SET" "$OUT/$ID"           # atomic publish
rm -rf "$GNUPGHOME"; rmdir "$TMP"; trap - EXIT
# retention (only complete sets of this label)
ls -1d "$OUT"/*-"$LABEL" 2>/dev/null | sort | head -n -"$KEEP" | while read -r old; do rm -rf "$old"; done
echo "SET_CREATED=$OUT/$ID files=$(ls "$OUT/$ID" | wc -l) size=$(du -sh "$OUT/$ID" | cut -f1)"
