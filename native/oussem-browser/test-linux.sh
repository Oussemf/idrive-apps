#!/bin/bash
set -euo pipefail
prefix=/var/opt/oussem-browser/current
stage="$PWD/dist/browser-installed"
mkdir -p "$stage"
tar -xzf dist/oussem-browser@0.1.0.tgz -C "$stage"
docker run --rm --cap-add SYS_ADMIN \
  -v "$stage/files:$prefix" \
  -v "$PWD/native/oussem-browser:/tests:ro" \
  ubuntu:18.04 bash -euc '
    apt-get update -qq
    apt-get install -y --no-install-recommends nodejs ca-certificates procps
    test "$(getconf GNU_LIBC_VERSION)" = "glibc 2.27"
    useradd -m -u 12345 browser-test
    mkdir -p /tmp/.X11-unix
    chmod 1777 /tmp/.X11-unix
    chown root:root /var/opt/oussem-browser/current/electron/chrome-sandbox
    chmod 4755 /var/opt/oussem-browser/current/electron/chrome-sandbox
    su -s /bin/sh browser-test -c "node /tests/test-runtime.js"
  '
