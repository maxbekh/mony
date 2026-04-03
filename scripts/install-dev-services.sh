#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_dir="${repo_root}/dev/systemd"
unit_dir="/etc/systemd/system"

mkdir -p "${unit_dir}"

for template in \
  "${template_dir}/mony-db.service.in" \
  "${template_dir}/mony-backend.service.in" \
  "${template_dir}/mony-frontend.service.in"
do
  unit_name="$(basename "${template%.in}")"
  sed "s|@REPO_ROOT@|${repo_root}|g" "${template}" > "${unit_dir}/${unit_name}"
done

install -m 0644 "${template_dir}/mony-dev.target" "${unit_dir}/mony-dev.target"

systemctl daemon-reload
systemctl enable mony-db.service mony-backend.service mony-frontend.service mony-dev.target >/dev/null

cat <<EOF
Installed mony dev services in ${unit_dir}.

Useful commands:
  systemctl start mony-dev.target
  systemctl stop mony-dev.target
  systemctl restart mony-backend.service
  systemctl restart mony-frontend.service
  journalctl -u mony-backend.service -f
EOF
