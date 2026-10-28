# Linux build and test container

`linux.Dockerfile` builds an image with Node 24, pnpm, build tools for the native modules (`node-pty`, `node-datachannel`), Electron's Linux libraries and `xvfb` for headless Electron tests.

Base images come from the test environment's ECR pull-through cache for Docker Hub (`654261343536.dkr.ecr.eu-central-1.amazonaws.com/tst-docker-hub/...`).

## Use

```sh
just ecr-login     # Docker login to ECR using the `tst` AWS profile
just linux-check   # build the image and run lint, type check and tests in it
```

The `check` stage copies the repository (without `node_modules`) and runs `pnpm install --frozen-lockfile`, so macOS native binaries never end up in the Linux build.

To pull from Docker Hub directly instead of ECR:

```sh
docker build -f docker/linux.Dockerfile --build-arg REGISTRY=docker.io --target check -t claude-share-linux-check .
```

## Colima on macOS

Start Colima from a normal terminal. A VM started from a sandboxed shell (such as Claude Code's) inherits its network restrictions and cannot reach any registry.
