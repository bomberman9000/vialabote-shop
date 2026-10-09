#!/usr/bin/env bash
# Vialabote DR — WireGuard leg inside the vialabote-dr VM (VM = client behind NAT).
# The tunnel ends INSIDE the VM, so the edge never reaches the ZeroHour host or its LAN:
#   VM wg0 10.77.0.2/32, peer = edge 10.77.0.1/32 only, keepalive 25s, no forwarding;
#   UFW: only tcp/8082 (limited-mode nginx) from 10.77.0.1 on wg0.
# usage:  vm-edge-tunnel.sh keygen
#         vm-edge-tunnel.sh up <edge_public_ip> <edge_wg_pubkey>
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive
die() { echo "ABORT: $*" >&2; exit 1; }
[ "$(hostname)" = vialabote-dr ] || die "not the DR VM"
WG=/etc/wireguard
case "${1:-}" in
keygen)
  command -v wg >/dev/null || apt-get install -y -qq wireguard-tools >/dev/null
  umask 077; install -d -m 0700 $WG
  [ -f $WG/vm.key ] || wg genkey > $WG/vm.key
  wg pubkey < $WG/vm.key > $WG/vm.pub
  echo "VM_WG_PUBKEY=$(cat $WG/vm.pub)"
  ;;
up)
  EIP=${2:?edge ip}; EPUB=${3:?edge pubkey}
  [[ "$EIP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "bad ip"
  [[ "$EPUB" =~ ^[A-Za-z0-9+/]{43}=$ ]] || die "bad pubkey"
  [ -f $WG/vm.key ] || die "run keygen first"
  umask 077
  cat > $WG/wg0.conf <<EOF
[Interface]
Address = 10.77.0.2/32
PostUp = wg set %i private-key $WG/vm.key
[Peer]
# DR-edge VPS
PublicKey = $EPUB
Endpoint = $EIP:51820
AllowedIPs = 10.77.0.1/32
PersistentKeepalive = 25
EOF
  systemctl enable wg-quick@wg0 >/dev/null 2>&1
  systemctl restart wg-quick@wg0
  ufw allow in on wg0 from 10.77.0.1 to any port 8082 proto tcp comment vialabote-edge >/dev/null
  for _ in $(seq 1 30); do
    HS=$(wg show wg0 latest-handshakes | awk '{print $2}'); [ "${HS:-0}" -gt 0 ] && break; sleep 1
  done
  [ "${HS:-0}" -gt 0 ] || die "no WireGuard handshake with $EIP:51820"
  ping -c2 -W2 10.77.0.1 >/dev/null && echo "ping edge 10.77.0.1 OK"
  echo "handshake $(( $(date +%s) - HS ))s ago; ip_forward=$(sysctl -n net.ipv4.ip_forward)"
  ufw status | grep -E '8082|wg0'
  echo "VM_TUNNEL=UP"
  ;;
*) sed -n '2,8p' "$0"; exit 2;;
esac
