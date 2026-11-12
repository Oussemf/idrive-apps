# Experimental MGU browser companion

This release supplies the missing browser tool, its private Linux libraries,
a private authenticated X display and the YouTube runtime sources.
The launcher detects the installed tool automatically; no runtime.json is needed.

In MGU Store, select source **Oussemf/idrive-apps**, channel **main**,
refresh, install **YouTube browser companion**, then update
**YouTube (experimental)**. The direct catalog URL is:
https://github.com/Oussemf/idrive-apps/releases/download/catalog/catalog.json

Automated release gates boot the bundle on an Ubuntu 18.04/glibc 2.27
userland as a non-root app uid, check real Chromium renderer seccomp sandboxing,
and verify offscreen frames through the MGU renderer protocol. This does
not reproduce the MGU kernel, OAP policy, audio stack or hardware.
Hardware compatibility remains experimental; keep the car parked.

The tool installs only under /var/opt/oussem-browser. No firmware libraries,
routes or system services are replaced. Its sole setuid program is the
upstream Chromium sandbox helper (root-owned mode 4755), which establishes
the browser sandbox; Chromium itself runs as the app uid. No --no-sandbox.
The tool starts no persistent service and can be removed from the Store.
The branch contains the precompiled payload, with Chromium compressed below
GitHub's per-file limit. The launcher streams it to its private app cache,
checks SHA-256 before execution, and uses the root-owned sandbox helper
installed by the Store. Allow about 250 MB of additional app data space.

Audio focus integration and performance need vehicle testing.
YouTube TV may redirect unsupported Chromium to the standard website.
Search requires a personal YouTube Data API key; opening a video URL does not.

Exact Ubuntu dependency sources and notices are provided beside the binary.
Electron's Chromium notices are included in the tool; upstream Electron source:
https://github.com/electron/electron/tree/v45.3.1
Build scripts and application source: https://github.com/Oussemf/idrive-apps
