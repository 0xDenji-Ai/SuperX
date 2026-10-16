#!/bin/bash
# macOS Apple Silicon and Intel. No sudo or security settings changes are used.
set -euo pipefail
unset NODE_OPTIONS NODE_PATH LD_PRELOAD DYLD_INSERT_LIBRARIES
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if [[ "$(uname -s)" != Darwin ]]; then printf '%s\n' 'This installer requires macOS.' >&2; exit 1; fi
case "$(uname -m)" in
  arm64) target=darwin-arm64; checksum=23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53 ;;
  x86_64) target=darwin-x64; checksum=8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8 ;;
  *) printf '%s\n' 'Unsupported Mac processor.' >&2; exit 1 ;;
esac
if [[ "${1:-}" == --uninstall ]]; then
  managed_root="$HOME/Library/Application Support/SuperX/Connector"
  # The common installer performs marker, exact user-directory and symlink checks.
  managed_node=''
  for candidate in "$managed_root"/releases/*/runtime/node; do
    if [[ -f "$candidate" && -x "$candidate" ]]; then managed_node="$candidate"; break; fi
  done
  if [[ -z "$managed_node" ]]; then printf '%s\n' 'No managed connector runtime was found.' >&2; exit 1; fi
  exec "$managed_node" "$(dirname "$(dirname "$managed_node")")/install.mjs" --uninstall
fi
task_temp=$(mktemp -d "${TMPDIR:-/tmp}/SuperX-Connector.XXXXXXXX")
cleanup() {
  case "$task_temp" in "${TMPDIR:-/tmp}"/SuperX-Connector.*) rm -rf -- "$task_temp" ;; *) return 1 ;; esac
}
trap cleanup EXIT
archive="$task_temp/node.tar.gz"
/usr/bin/curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 180 "https://nodejs.org/dist/v22.23.3/node-v22.23.3-$target.tar.gz" --output "$archive"
actual=$(/usr/bin/shasum -a 256 "$archive"); actual=${actual%% *}
if [[ "$actual" != "$checksum" ]]; then printf '%s\n' 'Official Node runtime integrity check failed.' >&2; exit 1; fi
/usr/bin/tar -xzf "$archive" -C "$task_temp" "node-v22.23.3-$target/bin/node"
"$task_temp/node-v22.23.3-$target/bin/node" "$script_dir/install.mjs" --node-archive "$archive" "$@"
