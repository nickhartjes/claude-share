# Signalling service image. Base images come through the test environment's ECR pull-through cache
# for Docker Hub; override REGISTRY (for example with docker.io) to pull elsewhere.
ARG REGISTRY=654261343536.dkr.ecr.eu-central-1.amazonaws.com/tst-docker-hub

FROM ${REGISTRY}/library/node:24-bookworm-slim AS build
# The optional npmrc secret points npm and pnpm at another registry (just local-up uses CodeArtifact);
# it is mounted only while installing, so it never ends up in an image layer.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm install -g pnpm@12.16.1
WORKDIR /repo
COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
  pnpm install --frozen-lockfile --filter "@claude-share/signalling..." \
  && pnpm --filter @claude-share/signalling build

# The bundle has no runtime dependencies, so the final image only needs Node.
FROM ${REGISTRY}/library/node:24-bookworm-slim
WORKDIR /app
COPY --from=build /repo/packages/signalling/dist/main.js ./main.js
# Numeric, so Kubernetes can verify runAsNonRoot (1000 is the node user in the official images).
USER 1000
ENV PORT=8080
EXPOSE 8080
CMD ["node", "main.js"]
