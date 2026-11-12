# Third-party components

`vendor/mgu-kit` contains the unmodified runtime, platform declarations,
localization data and selected build tools from
[cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps),
commit `58cb47d03015a55abd0d4ec2cefd9cb23a643551`, MIT.
Copyright (c) 2026 cauliflowermossgrape. The license is included there.
Font notices remain alongside the original font atlases.

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
