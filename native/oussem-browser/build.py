#!/usr/bin/env python3
"""Build a self-contained, pinned Electron tool kit; run inside the Dockerfile."""
import hashlib
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / "native" / "oussem-browser"
OUT = ROOT / "dist"
PREFIX = "/var/opt/oussem-browser/current"
ELECTRON = "45.3.1"
ELECTRON_SHA = "c61d44206f8bd533d30310840b5baaa7fd0e8421cd711b8d1f719a7a336cbce7"
STAGE = OUT / "browser-tool"
FILES = STAGE / "files"


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination, follow_symlinks=True)


def dependencies(binary):
    return [Path(line) for line in run("/usr/bin/python3", "/usr/bin/lddtree", "-l", str(binary)).splitlines()
            if line.startswith("/")]

def is_elf(file):
    with file.open("rb") as stream:
        return stream.read(4) == b"\x7fELF"


def package_owner(file):
    candidates = [str(file), str(file.resolve())]
    for candidate in list(candidates):
        if candidate.startswith("/usr/lib/") or candidate.startswith("/usr/bin/"):
            candidates.append(candidate[4:])
        elif candidate.startswith("/lib/") or candidate.startswith("/bin/"):
            candidates.append("/usr" + candidate)
    for candidate in dict.fromkeys(candidates):
        try:
            return run("dpkg-query", "-S", candidate).split(": ")[0]
        except subprocess.CalledProcessError:
            continue
    raise SystemExit("Cannot identify dependency package: " + str(file))


def main():
    if STAGE.exists():
        raise SystemExit("Build directory already exists; use a fresh checkout")
    FILES.mkdir(parents=True)
    archive = OUT / "electron.zip"
    url = f"https://github.com/electron/electron/releases/download/v{ELECTRON}/electron-v{ELECTRON}-linux-x64.zip"
    urllib.request.urlretrieve(url, archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ELECTRON_SHA:
        raise SystemExit("Electron checksum mismatch")
    with zipfile.ZipFile(archive) as zipped:
        zipped.extractall(FILES / "electron")
    for locale in (FILES / "electron" / "locales").glob("*.pak"):
        if locale.name not in ("en-US.pak", "fr.pak"):
            locale.unlink()
    elf_files = []
    for file in (FILES / "electron").rglob("*"):
        if file.is_file() and is_elf(file):
            elf_files.append(file)
    packages = set()
    libs = {}
    programs = [Path("/usr/local/bin/oussem-Xvfb"), Path("/usr/bin/xkbcomp")]
    # libpulse is dlopen'ed by Chromium; keep its private shared dependency too.
    extras = [Path("/usr/lib/x86_64-linux-gnu/libpulse.so.0"),
              Path("/usr/lib/x86_64-linux-gnu/libpulse-simple.so.0")]
    for binary in elf_files + programs + extras:
        for dependency in dependencies(binary):
            if dependency == binary or (FILES / "electron") in dependency.parents:
                continue
            previous = libs.get(dependency.name)
            if previous and previous.resolve() != dependency.resolve():
                raise SystemExit("Dependency basename collision: " + dependency.name)
            libs[dependency.name] = dependency
    for binary in programs:
        copy(binary, FILES / "bin" / ("Xvfb" if binary.name == "oussem-Xvfb" else binary.name))
    for binary in extras:
        libs[binary.name] = binary
    for name, source in sorted(libs.items()):
        copy(source, FILES / "lib" / name)
        packages.add(package_owner(source))
    for font in Path("/usr/share/fonts/truetype/dejavu").glob("*.ttf"):
        copy(font, FILES / "fonts" / font.name)
    packages.add("fonts-dejavu-core")
    packages.add("xvfb")
    packages.add("x11-xkb-utils")
    packages.add("xkb-data")
    shutil.copytree("/usr/share/X11/xkb", FILES / "xkb", symlinks=False)
    # Xvfb uses one virtual US keyboard; keep French and shared modifiers too.
    symbols = {"us", "fr", "pc", "inet", "group", "srvr_ctrl", "altwin", "keypad",
               "level3", "level5", "capslock", "compose", "ctrl", "shift", "eurosign", "latin"}
    for symbol in (FILES / "xkb" / "symbols").iterdir():
        if symbol.name not in symbols:
            if symbol.is_dir():
                shutil.rmtree(symbol)
            else:
                symbol.unlink()
    for geometry in (FILES / "xkb" / "geometry").iterdir():
        if geometry.name != "pc":
            geometry.unlink()
    # Keep every dependency under a root-owned tool prefix; never replace the system libc.
    for file in list((FILES / "electron").rglob("*")) + list((FILES / "lib").glob("*")) + list((FILES / "bin").glob("*")):
        if not file.is_file() or not is_elf(file):
            continue
        if file.name == "ld-linux-x86-64.so.2":
            continue
        run("patchelf", "--force-rpath", "--set-rpath", PREFIX + "/lib:" + PREFIX + "/electron", str(file))
        headers = run("readelf", "-l", str(file))
        if "Requesting program interpreter" in headers:
            run("patchelf", "--set-interpreter", PREFIX + "/lib/ld-linux-x86-64.so.2", str(file))
    engine = {"files": []}
    for name in ("electron", "icudtl.dat"):
        file = FILES / "electron" / name
        engine["files"].append({"name": name, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
        with file.open("rb") as source, (file.parent / (name + ".gz")).open("wb") as target:
            with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0) as compressed:
                shutil.copyfileobj(source, compressed)
        file.unlink()
    (FILES / "engine.json").write_text(json.dumps(engine, indent=2) + "\n")
    for name in ("launch.sh", "launch.js", "prepare-engine.js"):
        copy(NATIVE / name, FILES / name)
    for directory in ("runtime", "shared", "web"):
        shutil.copytree(ROOT / directory, FILES / "project" / directory)
    shutil.copytree(ROOT / "vendor" / "mgu-render", FILES / "project" / "vendor" / "mgu-render")
    for name in ("package.json", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"):
        copy(ROOT / name, FILES / "project" / name)
    copy(ROOT / "LICENSE", FILES / "LICENSE")
    installed = []
    for package in sorted(packages):
        info = run("dpkg-query", "-W", "-f=${binary:Package}\\t${Version}\\t${source:Package}\\t${source:Version}", package)
        installed.append(info)
        copyright_path = Path("/usr/share/doc") / package.split(":")[0] / "copyright"
        if not copyright_path.is_file():
            raise SystemExit("Missing copyright notice: " + package)
        copy(copyright_path, FILES / "licenses" / package.replace(":", "_") / "copyright")
    (FILES / "DEPENDENCIES.tsv").write_text("\n".join(installed) + "\n")
    # Publish exact Ubuntu dependency sources beside the binary (LGPL and other notices).
    sources = {}
    for line in installed:
        _, _, source, version = line.split("\t")
        sources[source] = version
    source_dir = OUT / "dependency-sources"
    source_dir.mkdir()
    apt_sources = Path("/etc/apt/sources.list.d/ubuntu.sources")
    apt_sources.write_text(apt_sources.read_text().replace("Types: deb\n", "Types: deb deb-src\n"))
    subprocess.run(["apt-get", "update"], check=True, stdout=subprocess.DEVNULL)
    for package, version in sorted(sources.items()):
        subprocess.run(["apt-get", "source", "--download-only", package + "=" + version],
                       cwd=source_dir, check=True, stdout=subprocess.DEVNULL)
    with tarfile.open(OUT / "oussem-browser-dependency-sources.tar.gz", "w:gz") as archive_sources:
        archive_sources.add(source_dir, arcname="sources")
    component = json.loads((NATIVE / "component.json").read_text())
    entries = []
    for file in sorted(FILES.rglob("*")):
        if not file.is_file():
            continue
        name = file.relative_to(FILES).as_posix()
        mode = "0644"
        if name == "launch.sh" or is_elf(file):
            mode = "0755"
        if name == "electron/chrome-sandbox":
            mode = "4755"
        os.chmod(file, int(mode, 8))
        entries.append({"path": name, "mode": mode,
                        "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
    component["files"] = entries
    (STAGE / "component.json").write_text(json.dumps(component, indent=2) + "\n")
    artifact = OUT / f"oussem-browser@{component['version']}.tgz"
    with tarfile.open(artifact, "w:gz") as kit:
        kit.add(STAGE / "component.json", arcname="component.json")
        kit.add(FILES, arcname="files")
    print(json.dumps({"artifact": str(artifact), "size": artifact.stat().st_size,
                      "files": len(entries), "electron": ELECTRON}))


if __name__ == "__main__":
    main()
