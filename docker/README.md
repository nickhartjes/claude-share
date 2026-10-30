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
docker build -f docker/linux.Dockerfile --build-arg REGISTRY=docker.io --target check -t specdeck-linux-check .
```

## npm registry

The network blocks `registry.npmjs.org`, so the `just` recipes build with an `npmrc` build secret from `scripts/codeartifact-npmrc.sh`: the company's CodeArtifact npm registry with a fresh token (AWS profile `entrnce`). The secret is mounted only during installs and never ends up in an image layer. Without the secret (as in CI), builds use the public registry.

## Local cluster

`deploy/k8s/local` deploys `signalling` and `coturn` to Colima's built-in k3s (`colima start --kubernetes`), with Docker Hub images and only the differences a laptop needs patched in (see the comments there).

```sh
just local-up     # build the signalling image and deploy to namespace specdeck-local
just local-test   # run packages/daemon/src/cluster.test.ts against it, from the Linux container
just local-down   # remove the namespace
```

`local-test` runs the tests inside the VM's network (`docker run --network host`), because coturn needs UDP: Colima forwards only TCP ports to the Mac. The tests check that coturn accepts credentials from the shared secret and refuses expired or wrongly signed ones, and that a host and 1 or 20 viewers connect through the deployed signalling service with every connection relayed by coturn.

`scripts/local-kubectl.sh` runs kubectl against the cluster through the port Colima forwards to localhost. macOS's Local Network privacy blocks most programs from the VM's own address (`no route to host`), even though `ping` works.

If k3s keeps restarting after Colima was started with different network settings (`systemctl show k3s -p NRestarts` in `colima ssh`), its generated kubeconfigs in `/var/lib/rancher/k3s/server/cred` may still point at the API server's previous port; replacing that port with the current one and restarting k3s fixes it.

## Colima on macOS

Start Colima from a normal terminal. A VM started from a sandboxed shell (such as Claude Code's) inherits its network restrictions and cannot reach any registry.
