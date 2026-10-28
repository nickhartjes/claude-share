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

# Lint, type-check and test inside the Linux container (needs Docker and an ECR login, see docker/README.md)
linux-check:
    docker build -f docker/linux.Dockerfile --target check -t claude-share-linux-check .
    docker run --rm claude-share-linux-check

# Log Docker in to the test environment's ECR (pull-through cache for Docker Hub images)
ecr-login:
    aws ecr get-login-password --profile tst --region eu-central-1 | docker login --username AWS --password-stdin 654261343536.dkr.ecr.eu-central-1.amazonaws.com
