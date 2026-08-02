# Reproducible build environment for the DTLN noise-suppression engine.
#
# Clones DataDog/dtln-rs at the pinned commit and compiles it to
# wasm32-unknown-emscripten. Upstream's .cargo/config.toml links with
# SINGLE_FILE=1, so the build output /src/dtln-rs/dtln.js is a single JS file
# with the wasm inlined — exactly what an AudioWorkletGlobalScope (which has no
# fetch) can load. tools/dtln/build.ts drives this image and assembles the
# final artifact.
FROM emscripten/emsdk:3.1.74

ENV RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain 1.85.0 \
        --target wasm32-unknown-emscripten

ARG DTLN_RS_COMMIT=5bd53c00d3334615f9b03fa7775402ae2a39b616
RUN git clone https://github.com/DataDog/dtln-rs.git /src/dtln-rs \
    && git -C /src/dtln-rs checkout --detach "$DTLN_RS_COMMIT"

WORKDIR /src/dtln-rs

# Upstream build.rs only defines main() for macOS/Windows build hosts (Datadog
# builds on macOS); append an equivalent of its macOS wasm branch — extract the
# prebuilt TFLite archive, link the static libs — for this Linux container.
COPY build-rs-linux-main.rs /tmp/build-rs-linux-main.rs
RUN cat /tmp/build-rs-linux-main.rs >> build.rs

RUN npm run install-wasm
