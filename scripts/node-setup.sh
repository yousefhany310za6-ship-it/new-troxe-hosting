#!/usr/bin/env bash
#
# Troxe Hosting — remote node onboarding (run as root on the NEW node).
#
# What it does:
#   1. installs Docker Engine (Debian/Ubuntu) if missing
#   2. creates a dedicated CA + server/client TLS material under /etc/troxe
#   3. configures dockerd for mutual-TLS on tcp://0.0.0.0:2376 (+ local socket)
#   4. installs STATIC host firewall rules for the sandbox supernet and
#      persists them (netfilter-persistent) — this is what isolates client
#      sandboxes on remote nodes (no per-sandbox rules cross the wire)
#   5. locks the Docker port to the API host (when API_IP is given)
#   6. prints the client bundle + the exact POST /admin/nodes payload
#
# Usage:
#   sudo SUBNET_BASE=10.201.0.0/16 API_IP=203.0.113.7 ./scripts/node-setup.sh
#
#   SUBNET_BASE  sandbox supernet for THIS node (required, /8-/24, must not
#                overlap other nodes or the node's own LAN/docker defaults)
#   API_IP       public IP of the Troxe API host (REQUIRED — the daemon port
#                is locked to it; set ALLOW_OPEN_DAEMON=1 to explicitly
#                accept an unrestricted port, e.g. lab behind NAT/VPN)
#   NODE_IPS     extra IPs for the server cert SAN, space-separated
#                (optional — needed when registering the node by IP)
#
set -euo pipefail

SUBNET_BASE="${SUBNET_BASE:?set SUBNET_BASE, e.g. SUBNET_BASE=10.201.0.0/16}"
API_IP="${API_IP:-}"
ALLOW_OPEN_DAEMON="${ALLOW_OPEN_DAEMON:-0}"
NODE_IPS="${NODE_IPS:-}"
DAEMON_PORT=2376
CERT_DIR=/etc/troxe/certs

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi
if [ -z "$API_IP" ] && [ "$ALLOW_OPEN_DAEMON" != "1" ]; then
  echo "refusing: set API_IP (the Troxe API host IP) or ALLOW_OPEN_DAEMON=1 to accept an unrestricted daemon port" >&2
  exit 1
fi
if [[ ! "$SUBNET_BASE" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/(8|9|1[0-9]|2[0-4])$ ]]; then
  echo "SUBNET_BASE must be a CIDR like 10.201.0.0/16 (mask 8-24)" >&2
  exit 1
fi

echo "==> [1/6] Docker Engine"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg iptables-persistent
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io
else
  apt-get install -y iptables-persistent >/dev/null
fi

echo "==> [2/6] TLS material ($CERT_DIR)"
mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"
cd "$CERT_DIR"
[ -f ca-key.pem ] || openssl genrsa -out ca-key.pem 4096
[ -f ca.pem ] || openssl req -new -x509 -days 825 -key ca-key.pem -sha256 -out ca.pem -subj "/CN=troxe-node-ca"
[ -f server-key.pem ] || openssl genrsa -out server-key.pem 4096
if [ ! -f server-cert.pem ]; then
  openssl req -new -key server-key.pem -out server.csr -subj "/CN=$(hostname -f 2>/dev/null || hostname)"
  HN=$(hostname -f 2>/dev/null || hostname)
  SAN="DNS:${HN},DNS:localhost,IP:127.0.0.1"
  for ip in $NODE_IPS; do SAN="${SAN},IP:${ip}"; done
  printf 'subjectAltName=%s\n' "$SAN" > server-ext.cnf
  openssl x509 -req -days 825 -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out server-cert.pem -sha256 -extfile server-ext.cnf
fi
[ -f client-key.pem ] || openssl genrsa -out client-key.pem 4096
if [ ! -f client-cert.pem ]; then
  openssl req -new -key client-key.pem -out client.csr -subj "/CN=troxe-api-client"
  printf 'extendedKeyUsage=clientAuth\n' > client-ext.cnf
  openssl x509 -req -days 825 -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out client-cert.pem -sha256 -extfile client-ext.cnf
fi
chmod 600 *-key.pem
rm -f ./*.csr ./*-ext.cnf

echo "==> [3/6] dockerd with mutual TLS"
mkdir -p /etc/docker
# never silently clobber an existing daemon config — keep one backup
if [ -f /etc/docker/daemon.json ] && [ ! -f /etc/docker/daemon.json.bak.troxe ]; then
  cp /etc/docker/daemon.json /etc/docker/daemon.json.bak.troxe
  echo "    existing daemon.json backed up to daemon.json.bak.troxe"
fi
cat > /etc/docker/daemon.json <<EOF
{
  "tlsverify": true,
  "tlscacert": "$CERT_DIR/ca.pem",
  "tlscert": "$CERT_DIR/server-cert.pem",
  "tlskey": "$CERT_DIR/server-key.pem",
  "hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:$DAEMON_PORT"]
}
EOF
systemctl enable --now docker
systemctl restart docker

echo "==> [4/6] static sandbox firewall ($SUBNET_BASE, persisted)"
for chain_rule in \
  "DOCKER-USER $SUBNET_BASE 169.254.0.0/16" \
  "DOCKER-USER $SUBNET_BASE 10.0.0.0/8" \
  "DOCKER-USER $SUBNET_BASE 172.16.0.0/12" \
  "DOCKER-USER $SUBNET_BASE 192.168.0.0/16" \
  "DOCKER-USER $SUBNET_BASE 100.64.0.0/10"; do
  # shellcheck disable=SC2086
  set -- $chain_rule
  iptables -w 5 -C "$1" -s "$2" -d "$3" -m comment --comment "troxe:node-supernet" -j DROP 2>/dev/null \
    || iptables -w 5 -I "$1" -s "$2" -d "$3" -m comment --comment "troxe:node-supernet" -j DROP
done
iptables -w 5 -C DOCKER-USER -s "$SUBNET_BASE" -m addrtype --dst-type LOCAL -m comment --comment "troxe:node-supernet" -j DROP 2>/dev/null \
  || iptables -w 5 -I DOCKER-USER -s "$SUBNET_BASE" -m addrtype --dst-type LOCAL -m comment --comment "troxe:node-supernet" -j DROP
iptables -w 5 -C INPUT -s "$SUBNET_BASE" -m comment --comment "troxe:node-supernet" -j DROP 2>/dev/null \
  || iptables -w 5 -I INPUT -s "$SUBNET_BASE" -m comment --comment "troxe:node-supernet" -j DROP
if [ -n "$API_IP" ]; then
  iptables -w 5 -C INPUT -p tcp --dport "$DAEMON_PORT" -s "$API_IP" -j ACCEPT 2>/dev/null \
    || iptables -w 5 -I INPUT -p tcp --dport "$DAEMON_PORT" -s "$API_IP" -j ACCEPT
  iptables -w 5 -C INPUT -p tcp --dport "$DAEMON_PORT" -j DROP 2>/dev/null \
    || iptables -w 5 -A INPUT -p tcp --dport "$DAEMON_PORT" -j DROP
  echo "    daemon port $DAEMON_PORT restricted to $API_IP"
else
  echo "    WARNING: ALLOW_OPEN_DAEMON=1 — daemon port $DAEMON_PORT is NOT IP-restricted" >&2
fi
netfilter-persistent save

echo "==> [5/6] verifying local daemon"
docker -H "tcp://127.0.0.1:$DAEMON_PORT" --tlsverify --tlscacert "$CERT_DIR/ca.pem" --tlscert "$CERT_DIR/client-cert.pem" --tlskey "$CERT_DIR/client-key.pem" version --format 'server {{.Server.Version}} OK'

NODE_IP=$(hostname -I | awk '{print $1}')
BUNDLE_DIR="$(pwd)/troxe-node-bundle"
mkdir -p "$BUNDLE_DIR"
chmod 700 "$BUNDLE_DIR"
cp "$CERT_DIR/ca.pem" "$BUNDLE_DIR/ca.pem"
cp "$CERT_DIR/client-cert.pem" "$BUNDLE_DIR/client-cert.pem"
cp "$CERT_DIR/client-key.pem" "$BUNDLE_DIR/client-key.pem"
chmod 600 "$BUNDLE_DIR"/*.pem
echo
echo "==> [6/6] register this node in the Troxe admin panel (Nodes → New node):"
echo "    host:       $NODE_IP"
echo "    port:       $DAEMON_PORT"
echo "    subnetBase: $SUBNET_BASE"
echo "    ca/cert/key: paste the CONTENTS of these files (key material is"
echo "                 written to files below — never printed to this terminal):"
echo "      $BUNDLE_DIR/ca.pem"
echo "      $BUNDLE_DIR/client-cert.pem"
echo "      $BUNDLE_DIR/client-key.pem"
echo
echo "Keep ca-key.pem + server-key.pem on this node only. Delete $BUNDLE_DIR after registering. Done."
