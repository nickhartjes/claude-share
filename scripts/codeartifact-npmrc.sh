#!/bin/sh
# Prints an npmrc for the company's CodeArtifact npm registry with a fresh token (valid 12 hours),
# for Docker builds on networks that block registry.npmjs.org. Needs the AWS profile `entrnce`.
set -eu
domain=entrnce
owner=350124346922
region=eu-central-1
repository=npm-store
url=$(aws codeartifact get-repository-endpoint --profile entrnce --region "$region" --domain "$domain" --domain-owner "$owner" --repository "$repository" --format npm --query repositoryEndpoint --output text)
token=$(aws codeartifact get-authorization-token --profile entrnce --region "$region" --domain "$domain" --domain-owner "$owner" --query authorizationToken --output text)
printf 'registry=%s\n//%s:_authToken=%s\n' "$url" "${url#https://}" "$token"
