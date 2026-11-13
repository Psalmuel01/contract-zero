#!/bin/sh
# Download the Kokoro-82M model files (Apache-2.0) into ./models, checksum-pinned.
# They are 120 MB, so they are fetched at build time, never committed.
set -eu
cd "$(dirname "$0")"
mkdir -p models
BASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
fetch() {
  if [ -f "models/$1" ] && [ "$(sum "models/$1")" = "$2" ]; then return 0; fi
  curl -fsSL -o "models/$1" "$BASE/$1"
  got=$(sum "models/$1")
  if [ "$got" != "$2" ]; then echo "checksum mismatch for $1: $got" >&2; rm -f "models/$1"; exit 1; fi
  echo "fetched $1"
}
fetch kokoro-v1.0.int8.onnx 6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb
fetch voices-v1.0.bin bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
