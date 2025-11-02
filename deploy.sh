#!/bin/bash

# Required environment variables:
#   GITHUB_TOKEN, GITHUB_ACTOR
set -e

if [[ -z "$GITHUB_TOKEN" || -z "$GITHUB_ACTOR" ]]; then
  echo "❌ One or more required environment variables are missing."
  echo "   GITHUB_TOKEN, GITHUB_ACTOR must be set."
  exit 1
fi

OWNER="${OWNER:-marcinparda}"
REPO="${REPO:-actual}"
DATA_DIR="${ACTUAL_DATA_DIR:-$HOME/actual-budget-data}"
PORT="${ACTUAL_PORT:-5006}"

echo "🔑 Logging in to GitHub Container Registry..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin

# App definitions: name, image, container, port
declare -A apps=(
  [actual-container]="5006"
)

for app in "${!apps[@]}"; do
  port="${apps[$app]}"
  image="ghcr.io/$OWNER/$REPO-$app:latest"
  container="$app"

  echo "� Stopping existing container $container if running..."
  docker stop "$container" 2>/dev/null || true
  docker rm "$container" 2>/dev/null || true

  echo "🗑️ Cleaning up old images for $container..."
  docker image prune -a -f

  echo "📥 Pulling latest image for $container..."
  docker pull "$image"

  echo "� Starting new container $container on port $port:80..."
  docker run -d \
    --name "$container" \
    --restart unless-stopped \
    -p "$port:$port" \
    -v "$DATA_DIR/data" \
    "$image"

  # Health check
  echo "🏥 Performing health check for $container..."
  sleep 5 # Wait for the container to start
  if docker ps --filter "name=$container" --filter "status=running" | grep -q "$container"; then
    echo "✅ $container is running successfully"
  else
    echo "❌ $container failed to start"
    docker logs "$container"
    exit 1
  fi
done

echo "✅ All deployments completed successfully"