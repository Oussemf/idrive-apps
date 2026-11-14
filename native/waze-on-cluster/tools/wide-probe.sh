#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Probe for the wide cluster map: puts the Waze map in cluster-render's
# `panel` target moved to another KOMBI slot (0x200 by default, the slot of
# BMW's full-width content 0x01000500) and stretched to a wide rect, to see
# whether the KOMBI draws that slot under the gauges (speed, rpm, BMW
# overlays on top) or over them. Configuration only: no binary changes.
#
# Run as root on the head unit (SSH):
#   sh wide-probe.sh apply [SLOT] [X,Y,W,H] [--take-over]
#   sh wide-probe.sh status
#   sh wide-probe.sh revert
#
# apply   backs up both local confs once, sets cluster-render's panel_slot,
#         waze-on-cluster's target (panel) and map_rect, then restarts both
#         services. --take-over also sets panel_take_over_stock = 1, so the
#         renderer unmaps the stock content holding the slot (the HMI maps
#         it again, behind ours; `revert` gives the slot back).
# status  prints the renderer's slot table and the last log lines.
# revert  puts both local confs back as they were and restarts both services.

set -u

CR_CONF=${CR_CONF:-/var/opt/cluster-render/cluster-render.local.conf}
WOC_CONF=${WOC_CONF:-/var/opt/waze-on-cluster/waze-on-cluster.local.conf}
CR_STATUS=${CR_STATUS:-/run/cluster-render/status.txt}
CR_LOG=${CR_LOG:-/var/opt/cluster-render/log/cluster-render.log}
WOC_LOG=${WOC_LOG:-/var/opt/waze-on-cluster/log/waze-on-cluster.log}
SYSTEMCTL=${SYSTEMCTL:-systemctl}
SUFFIX=.wide-probe.bak
ABSENT=.wide-probe.absent

die() { echo "wide-probe: $*" >&2; exit 1; }

# set_key FILE KEY VALUE: KEY = VALUE in FILE, replacing any earlier line of it.
set_key() {
    touch "$1" || die "cannot write $1"
    tmp="$1.wide-probe.tmp"
    grep -v "^[[:space:]]*$2[[:space:]]*=" "$1" > "$tmp" 2>/dev/null
    echo "$2 = $3" >> "$tmp"
    mv "$tmp" "$1" || die "cannot replace $1"
}

backup() {
    [ -e "$1$SUFFIX" ] || [ -e "$1$ABSENT" ] && return 0
    if [ -e "$1" ]; then
        cp -p "$1" "$1$SUFFIX" || die "cannot back up $1"
    else
        touch "$1$ABSENT" || die "cannot mark $1 as absent"
    fi
}

restore() {
    if [ -e "$1$SUFFIX" ]; then
        mv "$1$SUFFIX" "$1"
    elif [ -e "$1$ABSENT" ]; then
        rm -f "$1" "$1$ABSENT"
    else
        echo "wide-probe: no backup of $1, left as it is"
    fi
}

restart() {
    $SYSTEMCTL restart cluster-render.service || die "cluster-render did not restart"
    $SYSTEMCTL restart waze-on-cluster.service || die "waze-on-cluster did not restart"
}

status() {
    echo "== $CR_CONF"; cat "$CR_CONF" 2>/dev/null
    echo "== $WOC_CONF"; cat "$WOC_CONF" 2>/dev/null
    echo "== slots ($CR_STATUS)"
    grep -i 'slot' "$CR_STATUS" 2>/dev/null || echo "(no status file)"
    echo "== cluster-render log"; tail -n 25 "$CR_LOG" 2>/dev/null
    echo "== waze-on-cluster log"; tail -n 15 "$WOC_LOG" 2>/dev/null
}

[ "$(id -u)" = 0 ] || die "run as root"

case "${1:-}" in
apply)
    slot=${2:-0x200}
    rect=${3:-160,100,1600,520}
    take=0
    for a in "$@"; do [ "$a" = --take-over ] && take=1; done
    case "$slot" in --*) slot=0x200 ;; esac
    case "$rect" in --*) rect=160,100,1600,520 ;; esac
    echo "$slot" | grep -Eq '^0x[0-9a-fA-F]+$' || die "SLOT must be hex, like 0x200"
    echo "$rect" | grep -Eq '^[0-9]+,[0-9]+,[0-9]+,[0-9]+$' || die "RECT must be X,Y,W,H"
    backup "$CR_CONF"
    backup "$WOC_CONF"
    set_key "$CR_CONF" panel_slot "$slot"
    set_key "$CR_CONF" panel_take_over_stock "$take"
    set_key "$WOC_CONF" target panel
    set_key "$WOC_CONF" map_rect "$rect"
    chmod 0644 "$CR_CONF" "$WOC_CONF"
    restart
    echo "wide-probe: map in slot $slot at $rect (take-over $take); start the phone's projection, then: sh $0 status"
    ;;
status)
    status
    ;;
revert)
    restore "$CR_CONF"
    restore "$WOC_CONF"
    restart
    echo "wide-probe: back to the confs from before the probe"
    ;;
*)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
