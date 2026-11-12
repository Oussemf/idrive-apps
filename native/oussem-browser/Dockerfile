FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip python3 pax-utils patchelf \
    xvfb libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libdrm2 \
    libxss1 libxtst6 libpulse0 libegl1 libgles2 libgl1-mesa-dri \
    fonts-dejavu-core \
    && sed -i 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get update && apt-get build-dep -y xorg-server \
    && apt-get install -y --no-install-recommends meson ninja-build
RUN mkdir /xserver && cd /xserver && apt-get source xorg-server \
    && cd xorg-server-* && meson setup build \
      -Dxorg=false -Dxnest=false -Dxephyr=false \
      -Dxvfb=true -Dglamor=false -Dglx=false -Ddocs=false -Ddevel-docs=false -Dsecure-rpc=false \
      -Dxkb_dir=/var/opt/oussem-browser/current/xkb \
      -Dxkb_bin_dir=/var/opt/oussem-browser/current/bin \
      -Dxkb_output_dir=/tmp \
    && ninja -C build hw/vfb/Xvfb \
    && cp build/hw/vfb/Xvfb /usr/local/bin/oussem-Xvfb
WORKDIR /src
COPY . /src
RUN python3 native/oussem-browser/build.py
