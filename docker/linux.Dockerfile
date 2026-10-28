# Linux build and test image. Base images come through the test environment's ECR pull-through
# cache for Docker Hub; override REGISTRY to pull from Docker Hub directly.
ARG REGISTRY=654261343536.dkr.ecr.eu-central-1.amazonaws.com/tst-docker-hub
FROM ${REGISTRY}/library/node:24-bookworm AS base

# Build tools for native modules (node-pty, node-datachannel), Electron's runtime libraries and a
# virtual display for headless Electron tests.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 make g++ \
    xvfb xauth \
    libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 libxshmfence1 libdrm2 libatk-bridge2.0-0 libcups2 \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.16.1

WORKDIR /repo

FROM base AS check
COPY . .
RUN pnpm install --frozen-lockfile
CMD ["sh", "-c", "pnpm lint && pnpm typecheck && pnpm test"]
