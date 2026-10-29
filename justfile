# List available recipes
default:
    @just --list

# Install dependencies for all packages
install:
    pnpm install

# Start the desktop app in development mode
dev:
    pnpm --filter @claude-share/app dev

# Build the desktop app
build:
    pnpm --filter @claude-share/app build

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

# Lint, type-check and test inside the Linux container (needs Docker, an ECR login and CodeArtifact access, see docker/README.md)
linux-check:
    CLAUDE_SHARE_NPMRC="$(scripts/codeartifact-npmrc.sh)" docker build --secret id=npmrc,env=CLAUDE_SHARE_NPMRC -f docker/linux.Dockerfile --target check -t claude-share-linux-check .
    docker run --rm claude-share-linux-check

# Log Docker in to the test environment's ECR (pull-through cache for Docker Hub images)
ecr-login:
    aws ecr get-login-password --profile tst --region eu-central-1 | docker login --username AWS --password-stdin 654261343536.dkr.ecr.eu-central-1.amazonaws.com

# Build the signalling service container image (needs Docker, an ECR login and CodeArtifact access)
signalling-image tag="claude-share-signalling:latest":
    CLAUDE_SHARE_NPMRC="$(scripts/codeartifact-npmrc.sh)" docker build --secret id=npmrc,env=CLAUDE_SHARE_NPMRC -f docker/signalling.Dockerfile -t {{tag}} .

# Deploy signalling and coturn to Colima's local cluster (deploy/k8s/local), with Docker Hub images and CodeArtifact
local-up:
    #!/usr/bin/env bash
    set -euo pipefail
    test -f deploy/k8s/base/turn-secret.env || (umask 077 && echo "TURN_SECRET=$(openssl rand -hex 32)" > deploy/k8s/base/turn-secret.env)
    CLAUDE_SHARE_NPMRC="$(scripts/codeartifact-npmrc.sh)" docker build --secret id=npmrc,env=CLAUDE_SHARE_NPMRC -f docker/signalling.Dockerfile --build-arg REGISTRY=docker.io -t claude-share-signalling:latest .
    scripts/local-kubectl.sh apply -k deploy/k8s/local
    # The image tag does not change between builds: restart to pick up the new image.
    scripts/local-kubectl.sh -n claude-share-local rollout restart deployment/claude-share-signalling
    scripts/local-kubectl.sh -n claude-share-local rollout status deployment/claude-share-signalling deployment/claude-share-turn --timeout=120s

# Test sharing through the local cluster's signalling and TURN, from the Linux container on the cluster's network
local-test: local-up
    #!/usr/bin/env bash
    set -euo pipefail
    CLAUDE_SHARE_NPMRC="$(scripts/codeartifact-npmrc.sh)" docker build --secret id=npmrc,env=CLAUDE_SHARE_NPMRC -f docker/linux.Dockerfile --build-arg REGISTRY=docker.io --target check -t claude-share-linux-check .
    signalling_ip=$(scripts/local-kubectl.sh -n claude-share-local get service claude-share-signalling -o jsonpath='{.spec.clusterIP}')
    node_ip=$(scripts/local-kubectl.sh get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' | tr ' ' '\n' | grep -m1 -v ':')
    export CLAUDE_SHARE_CLUSTER_TURN_SECRET=$(sed -n 's/^TURN_SECRET=//p' deploy/k8s/base/turn-secret.env)
    docker run --rm --network host \
      -e CLAUDE_SHARE_CLUSTER_SIGNALLING_URL="ws://${signalling_ip}:8080/signal" \
      -e CLAUDE_SHARE_CLUSTER_TURN_URL="turn:${node_ip}:3478?transport=udp" \
      -e CLAUDE_SHARE_CLUSTER_TURN_SECRET \
      claude-share-linux-check pnpm vitest run packages/daemon/src/cluster.test.ts

# Remove the local cluster deployment
local-down:
    scripts/local-kubectl.sh delete namespace claude-share-local --ignore-not-found

# Package the desktop app for this computer's platform, unsigned (installers in packages/app/release)
package:
    pnpm --filter @claude-share/app build
    CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @claude-share/app exec electron-builder --publish never
