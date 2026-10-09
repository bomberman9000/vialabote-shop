#!/usr/bin/env bash
# Vialabote DR — PHASE 2: create the isolated DR VM `vialabote-dr` on ZeroHour.
# Runbook: ~/Obsidian/projects/vialabote/VIALABOTE-DR-ZEROHOUR.md
#
# Runs ON ZeroHour as user `zero` (member of libvirt + kvm; no sudo needed).
# Touches only: /srv/zero-data/storage/vms/vialabote-dr/ and libvirt domain
# `vialabote-dr` (+ its autostart flag). Existing VMs, containers, firewall,
# SoftZero/AI workloads are only READ (before/after snapshot).
#
# VM: Ubuntu Server 24.04 LTS cloud image (SHA256-verified), 2 vCPU, 4 GB,
# 60 GB qcow2 (full copy, no backing file), libvirt `default` NAT network,
# cloud-init: admin `vladmin` (SSH key only, no password, sudo NOPASSWD),
# root login off, UFW deny-in (SSH only from the host 192.168.122.1),
# unattended security upgrades, time sync, persistent journal, qemu-guest-agent.
#
# usage (on ZeroHour):  bash phase2-create-vm.sh "<ssh public key>"
set -euo pipefail
export LC_ALL=C
PUBKEY="${1:?usage: phase2-create-vm.sh '<ssh-ed25519 ... comment>'}"
NAME=vialabote-dr
DIR=/srv/zero-data/storage/vms/$NAME
IMG_URL=https://cloud-images.ubuntu.com/noble/current
IMG=noble-server-cloudimg-amd64.img
VIRSH="virsh -c qemu:///system"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
host_snapshot() {
  $VIRSH list --all | sed -n '3,$p' | awk 'NF && $2!="'$NAME'"{print "vm",$2,$3,$4}'
  echo "containers_running $(docker ps -q | wc -l) unhealthy $(docker ps --filter health=unhealthy -q | wc -l)"
}

case "$PUBKEY" in ssh-ed25519\ *) ;; *) die "expected an ssh-ed25519 public key" ;; esac

step "0/7 preflight"
$VIRSH dominfo "$NAME" >/dev/null 2>&1 && die "domain $NAME already exists — nothing changed"
[ -e "$DIR/disk.qcow2" ] && die "$DIR/disk.qcow2 already exists — nothing changed"
[ "$(free -m | awk '/^Mem/{print $7}')" -ge 8192 ] || die "less than 8 GB RAM available on the host"
[ "$(df -BG --output=avail /srv/zero-data | tail -1 | tr -dc 0-9)" -ge 80 ] || die "less than 80 GB free on /srv/zero-data"
mkdir -p "$DIR"; cd "$DIR"
host_snapshot > "host-before-$STAMP.txt"; cat "host-before-$STAMP.txt"

step "1/7 Ubuntu 24.04 cloud image + SHA256 verification"
curl -fsSL -o SHA256SUMS "$IMG_URL/SHA256SUMS"
curl -fsSL -o SHA256SUMS.gpg "$IMG_URL/SHA256SUMS.gpg"
if [ -r /usr/share/keyrings/ubuntu-cloudimage-keyring.gpg ]; then
  gpgv --keyring /usr/share/keyrings/ubuntu-cloudimage-keyring.gpg SHA256SUMS.gpg SHA256SUMS 2>&1 | tail -1
  echo "SHA256SUMS signature: verified with ubuntu-cloudimage-keyring"
else
  echo "SHA256SUMS signature: NOT verified (ubuntu-cloudimage-keyring not installed) — checksum only, over HTTPS"
fi
[ -f "$IMG" ] && grep -q " \*$IMG\$" SHA256SUMS && sha256sum -c --ignore-missing --quiet SHA256SUMS 2>/dev/null || curl -fsSL -o "$IMG" "$IMG_URL/$IMG"
grep " \*$IMG\$" SHA256SUMS | sha256sum -c - || die "cloud image checksum mismatch"

step "2/7 system disk: 60 GB qcow2 (standalone copy)"
qemu-img convert -O qcow2 "$IMG" disk.qcow2
qemu-img resize disk.qcow2 60G >/dev/null
qemu-img info disk.qcow2 | grep -E "virtual size|disk size|backing" || true

step "3/7 cloud-init"
cat > meta-data <<EOF
instance-id: $NAME-$STAMP
local-hostname: $NAME
EOF
cat > user-data <<EOF
#cloud-config
hostname: $NAME
preserve_hostname: false
disable_root: true
ssh_pwauth: false
users:
  - name: vladmin
    gecos: Vialabote DR admin
    groups: [sudo]
    shell: /bin/bash
    lock_passwd: true
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    ssh_authorized_keys:
      - $PUBKEY
package_update: true
packages: [qemu-guest-agent, ufw, unattended-upgrades]
write_files:
  - path: /etc/ssh/sshd_config.d/60-vialabote-dr.conf
    content: |
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitRootLogin no
      AllowUsers vladmin
  - path: /etc/systemd/journald.conf.d/60-persistent.conf
    content: |
      [Journal]
      Storage=persistent
  - path: /etc/apt/apt.conf.d/20auto-upgrades
    content: |
      APT::Periodic::Update-Package-Lists "1";
      APT::Periodic::Unattended-Upgrade "1";
runcmd:
  - [systemctl, enable, --now, qemu-guest-agent]
  - [mkdir, -p, /var/log/journal]
  - [systemctl, restart, systemd-journald]
  - [timedatectl, set-ntp, "true"]
  - [ufw, default, deny, incoming]
  - [ufw, default, allow, outgoing]
  - [ufw, allow, from, 192.168.122.1, to, any, port, "22", proto, tcp]
  - [ufw, --force, enable]
  - [systemctl, restart, ssh]
final_message: "vialabote-dr cloud-init done after \$UPTIME s"
EOF

step "4/7 virt-install"
virt-install --connect qemu:///system --name "$NAME" --memory 4096 --vcpus 2 --cpu host-passthrough \
  --osinfo ubuntu24.04 --import \
  --disk "path=$DIR/disk.qcow2,format=qcow2,bus=virtio" \
  --network network=default,model=virtio \
  --channel unix,target.type=virtio,target.name=org.qemu.guest_agent.0 \
  --graphics none --noautoconsole \
  --cloud-init "user-data=$DIR/user-data,meta-data=$DIR/meta-data"
$VIRSH autostart "$NAME"

step "5/7 wait for guest agent + IP"
IP=""
for _ in $(seq 1 90); do
  # `|| true`: until the guest agent is up domifaddr fails, and under
  # set -e + pipefail that would end the script silently (seen on first run).
  IP=$($VIRSH domifaddr "$NAME" --source agent 2>/dev/null | awk '$1!="lo" && $3=="ipv4"{split($4,a,"/");print a[1]}' | head -1 || true)
  [ -n "$IP" ] && break; sleep 5
done
[ -n "$IP" ] || die "no IP from guest agent after 7.5 min (VM left running for inspection; virsh console $NAME)"
echo "vm_ip $IP"; echo "$IP" > vm-ip.txt

step "6/7 autostart"
# cloud-init completion is verified from the admin side over SSH
# (`cloud-init status --wait`), not here: guest-exec only reports that a
# command was started, not its result.
echo "autostart: $($VIRSH dominfo "$NAME" | awk '/^Autostart/{print $2}')"

step "7/7 host after"
host_snapshot > "host-after-$STAMP.txt"; cat "host-after-$STAMP.txt"
diff "host-before-$STAMP.txt" "host-after-$STAMP.txt" && echo "HOST_WORKLOADS=UNCHANGED" || echo "HOST_WORKLOADS=CHANGED (see diff)"
echo "VM_CREATED=$NAME ip=$IP dir=$DIR"
