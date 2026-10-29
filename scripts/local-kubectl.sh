#!/bin/sh
# kubectl for Colima's local cluster. macOS's Local Network privacy blocks most programs from
# reaching the VM's own address, so this talks to the API server through the port Colima forwards to
# localhost instead of the address in the kubeconfig.
set -eu
port=$(kubectl config view -o jsonpath='{.clusters[?(@.name=="colima")].cluster.server}' | sed 's/.*://')
if [ -z "$port" ]; then
  echo "No 'colima' cluster in the kubeconfig. Start one with: colima start --kubernetes" >&2
  exit 1
fi
exec kubectl --context colima --server "https://127.0.0.1:${port}" "$@"
