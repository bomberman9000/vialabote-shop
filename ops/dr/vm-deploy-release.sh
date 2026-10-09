#!/usr/bin/env bash
# Vialabote DR — install a git/CI-built release bundle (delivered by ZeroHour into
# /srv/dr-inbox/releases/) as /opt/<site>/releases/<sha7> + `current` symlink.
# Runs INSIDE vialabote-dr as root. Verifies the bundle SHA256 first; a bundle
# without a matching .sha256 or a READY marker is never installed.
#
# usage: bash vm-deploy-release.sh site1 <bundle-file>   (e.g. site1-8eaa013.tar.gz)
#        bash vm-deploy-release.sh site2 <bundle-file>   (e.g. app-4d57026.tar.gz)
set -euo pipefail
export LC_ALL=C
SITE=${1:?site1|site2}; BUNDLE=${2:?bundle file name}
IN=/srv/dr-inbox/releases
die() { echo "ABORT: $*" >&2; exit 1; }
[ -f "$IN/READY" ] || die "no READY marker in $IN (transfer incomplete)"
[ -f "$IN/$BUNDLE" ] && [ -f "$IN/$BUNDLE.sha256" ] || die "bundle or .sha256 missing"
(cd "$IN" && sha256sum -c --quiet "$BUNDLE.sha256") || die "SHA256 mismatch for $BUNDLE"

case "$SITE" in
  site1) OPT=/opt/vialabote; OWNER=vialabote ;;
  site2) OPT=/opt/vialabote-shop; OWNER=vialabote-shop ;;
  *) die "unknown site $SITE" ;;
esac
S7=$(echo "$BUNDLE" | grep -oE '[0-9a-f]{7}' | head -1)
REL=$OPT/releases/$S7
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
[ -e "$REL" ] && mv "$REL" "$REL.previous-$STAMP"
install -d -m 0755 "$REL"
tar -C "$REL" -xzf "$IN/$BUNDLE"
chown -R root:"$OWNER" "$REL"; chmod -R go-w "$REL"
[ -d "$REL/.next" ] && chown -R "$OWNER:$OWNER" "$REL/.next"
if [ "$SITE" = site2 ]; then
  # uploads live outside the release (persistent), like on PRIMARY
  if [ -e "$REL/public/uploads" ] && [ ! -L "$REL/public/uploads" ]; then mv "$REL/public/uploads" "/var/lib/vialabote-dr/releases/site2-uploads-from-bundle-$STAMP"; fi
  ln -sfn "$OPT/shared/uploads" "$REL/public/uploads"
fi
ln -sfn "releases/$S7" "$OPT/current"
cp "$IN/$BUNDLE.sha256" "/var/lib/vialabote-dr/releases/$SITE-current.sha256"
COMMIT=$(cat "$REL/.release-commit" 2>/dev/null || echo "$S7 (bundle name)")
echo "DEPLOYED $SITE $REL commit=$COMMIT sha256=$(cut -c1-16 "$IN/$BUNDLE.sha256")"
