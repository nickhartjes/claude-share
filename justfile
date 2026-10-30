# List available recipes
default:
    @just --list

# Install dependencies for all packages
install:
    pnpm install

# Start the desktop app in development mode
dev:
    pnpm --filter @specdeck/app dev

# Build the desktop app
build:
    pnpm --filter @specdeck/app build

# Lint all packages
lint:
    pnpm lint

# Type-check all packages
typecheck:
    pnpm typecheck

# Run all tests
test:
    pnpm test

# Lint, type-check and test
check: lint typecheck test

# Update dependencies within their ranges, skipping versions published less than `days` ago, then
# install from the lockfile as CI does and check; `just outdated` shows the major updates left.
# `days` can be raised but not lowered below minimumReleaseAge in pnpm-workspace.yaml, which CI enforces.
update days="1":
    #!/usr/bin/env sh
    set -eu
    floor=$(pnpm config get minimumReleaseAge)
    age=$(( {{days}} * 1440 ))
    if [ "$age" -lt "$floor" ]; then
      echo "days={{days}} is below minimumReleaseAge ($floor minutes); CI would reject the lockfile" >&2
      exit 1
    fi
    pnpm --config.minimumReleaseAge="$age" update -r
    pnpm install --frozen-lockfile
    just check

# List dependencies with newer versions, including major ones that `just update` leaves alone
outdated:
    pnpm outdated -r

# Lint, type-check and test inside the Linux container (needs Docker, an ECR login and CodeArtifact access, see docker/README.md)
linux-check:
    SPECDECK_NPMRC="$(scripts/codeartifact-npmrc.sh)" docker build --secret id=npmrc,env=SPECDECK_NPMRC -f docker/linux.Dockerfile --target check -t specdeck-linux-check .
    docker run --rm specdeck-linux-check

# Log Docker in to the test environment's ECR (pull-through cache for Docker Hub images)
ecr-login:
    aws ecr get-login-password --profile tst --region eu-central-1 | docker login --username AWS --password-stdin 654261343536.dkr.ecr.eu-central-1.amazonaws.com

# Build the signalling service container image (needs Docker, an ECR login and CodeArtifact access)
signalling-image tag="specdeck-signalling:latest":
    SPECDECK_NPMRC="$(scripts/codeartifact-npmrc.sh)" docker build --secret id=npmrc,env=SPECDECK_NPMRC -f docker/signalling.Dockerfile -t {{tag}} .

# Deploy signalling and coturn to Colima's local cluster (deploy/k8s/local), with Docker Hub images and CodeArtifact
local-up:
    #!/usr/bin/env bash
    set -euo pipefail
    test -f deploy/k8s/base/turn-secret.env || (umask 077 && echo "TURN_SECRET=$(openssl rand -hex 32)" > deploy/k8s/base/turn-secret.env)
    SPECDECK_NPMRC="$(scripts/codeartifact-npmrc.sh)" docker build --secret id=npmrc,env=SPECDECK_NPMRC -f docker/signalling.Dockerfile --build-arg REGISTRY=docker.io -t specdeck-signalling:latest .
    scripts/local-kubectl.sh apply -k deploy/k8s/local
    # The image tag does not change between builds: restart to pick up the new image.
    scripts/local-kubectl.sh -n specdeck-local rollout restart deployment/specdeck-signalling
    scripts/local-kubectl.sh -n specdeck-local rollout status deployment/specdeck-signalling deployment/specdeck-turn --timeout=120s

# Test sharing through the local cluster's signalling and TURN, from the Linux container on the cluster's network
local-test: local-up
    #!/usr/bin/env bash
    set -euo pipefail
    SPECDECK_NPMRC="$(scripts/codeartifact-npmrc.sh)" docker build --secret id=npmrc,env=SPECDECK_NPMRC -f docker/linux.Dockerfile --build-arg REGISTRY=docker.io --target check -t specdeck-linux-check .
    signalling_ip=$(scripts/local-kubectl.sh -n specdeck-local get service specdeck-signalling -o jsonpath='{.spec.clusterIP}')
    node_ip=$(scripts/local-kubectl.sh get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' | tr ' ' '\n' | grep -m1 -v ':')
    export SPECDECK_CLUSTER_TURN_SECRET=$(sed -n 's/^TURN_SECRET=//p' deploy/k8s/base/turn-secret.env)
    docker run --rm --network host \
      -e SPECDECK_CLUSTER_SIGNALLING_URL="ws://${signalling_ip}:8080/signal" \
      -e SPECDECK_CLUSTER_TURN_URL="turn:${node_ip}:3478?transport=udp" \
      -e SPECDECK_CLUSTER_TURN_SECRET \
      specdeck-linux-check pnpm vitest run packages/daemon/src/cluster.test.ts

# Remove the local cluster deployment
local-down:
    scripts/local-kubectl.sh delete namespace specdeck-local --ignore-not-found

# The viewer keeps its own settings in .local-dev/viewer. Both apps run on this Mac, so they connect
# directly, not through TURN. Closing the host window stops everything.
# Deploy the local cluster and open a host and a viewer development app against it
local-dev: local-up
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill $(jobs -p) 2>/dev/null || true' EXIT
    scripts/local-kubectl.sh -n specdeck-local port-forward svc/specdeck-signalling 8080:8080 >/dev/null &
    until nc -z localhost 8080 2>/dev/null; do sleep 0.5; done
    export SPECDECK_SIGNALLING_URL=ws://localhost:8080/signal
    # Electron crashes (SIGTRAP) if its userData directory does not exist yet.
    mkdir -p .local-dev/viewer
    log=.local-dev/host.log
    (cd packages/app && pnpm exec electron-vite dev) 2>&1 | tee "$log" &
    host=$!
    # The viewer is a second Electron process on the host's build, using the same dev server.
    until url=$(grep -om1 'http://localhost:[0-9]*' "$log"); do sleep 0.5; done
    until grep -q 'starting electron app' "$log"; do sleep 0.5; done
    (cd packages/app && ELECTRON_RENDERER_URL="$url" SPECDECK_USER_DATA="$PWD/../../.local-dev/viewer" pnpm exec electron .) &
    wait "$host"

# Package the desktop app for this computer's platform, unsigned (installers in packages/app/release)
package:
    pnpm --filter @specdeck/app build
    CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @specdeck/app exec electron-builder --publish never
