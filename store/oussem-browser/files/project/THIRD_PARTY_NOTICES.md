# Third-party components

`vendor/mgu-kit` contains the runtime, platform declarations,
localization data and selected build tools from
[cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps),
commit `58cb47d03015a55abd0d4ec2cefd9cb23a643551`, MIT.
Copyright (c) 2026 cauliflowermossgrape. The license is included there.
Font notices remain alongside the original font atlases.
Local change: the kit build function has an explicit `sdk_free` parameter
to omit SDK copying when creating packages for the Store's donor injection.
The original default SDK requirement and preview behavior are unchanged.

`vendor/mgu-render` contains `kit/renderd/js/mgu_render_client.js` from the
same commit. This is the native mgu-render protocol client, with contributions
from Robert Nisipeanu and IterioDev, copyright 2026.
The containing upstream `kit/renderd` directory is explicitly licensed
**GPL-3.0-or-later** (see its README, "Licence"); earlier renderer portions
also retain their MIT notice. Both original license files are included.
The integrated idrive-apps project is therefore GPL-3.0-or-later;
the independently vendored MGU kit retains MIT.
No renderer binaries or firmware files are redistributed.

Electron and Playwright are development/runtime dependencies with their own
licenses, supplied through npm rather than copied here.

No BMW SDK, firmware, logos, YouTube assets, downloaded videos or credentials
are included. The BMW OAP SDK must be supplied locally by the owner's head unit.
The YouTube website and official embedded player load from YouTube at runtime.
This project is not affiliated with BMW, Google or YouTube.

The optional `oussem-browser` release tool redistributes the official Electron
45.3.1 Linux x64 build (SHA-256 pinned in its build script), including
Electron's LICENSE and LICENSES.chromium.html. Electron's source and Chromium
build instructions are available at https://github.com/electron/electron/tree/v45.3.1.
The tool also contains Ubuntu 24.04 runtime libraries, Xvfb (built with private
XKB paths), xkbcomp, XKB data and DejaVu fonts. Per-package copyright notices
and exact binary/source versions are shipped in `licenses/` and
`DEPENDENCIES.tsv`. Corresponding Ubuntu dependency source archives are
published as `oussem-browser-dependency-sources.tar.gz` alongside the tool.
The build Dockerfile and scripts record all compilation and relocation changes.
