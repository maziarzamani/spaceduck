#!/usr/bin/env bash
set -euo pipefail

# Docker smoke test for spaceduck.
# Runnable locally:  ./scripts/smoke-docker.sh
# Called by CI:      scripts/smoke-docker.sh

IMAGE_TAG="spaceduck-smoke:$(date +%s)-$$"
CID=""
VOL="spaceduck-smoke-$$"

cleanup() {
  code=$?
  if [ $code -ne 0 ] && [ -n "${CID:-}" ]; then
    echo ""
    echo "=== Container logs (failure) ==="
    docker logs "$CID" 2>&1 || true
  fi
  [ -n "${CID:-}" ] && docker rm -f "$CID" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  if [ $code -eq 0 ]; then
    echo ""
    echo "Smoke test passed."
  else
    echo ""
    echo "Smoke test FAILED (exit $code)."
  fi
  exit $code
}
trap cleanup EXIT

echo "=== Building image: $IMAGE_TAG ==="
docker build --pull -t "$IMAGE_TAG" .

echo ""
echo "=== Starting container ==="
CID=$(docker run -d \
  --name "spaceduck-smoke-$$" \
  -v "$VOL":/data \
  -e MEMORY_CONNECTION_STRING=/data/spaceduck.db \
  "$IMAGE_TAG")
echo "Container: $CID"

echo ""
echo "=== Waiting for /api/health ==="
PORT=$(docker inspect --format='{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$CID" 2>/dev/null || echo "")
if [ -z "$PORT" ]; then
  # No port mapping; exec inside container instead
  HEALTH_CMD='bun -e "const r=await fetch(\"http://127.0.0.1:3000/api/health\");if(!r.ok)throw 1;console.log(await r.text())"'
  for i in $(seq 1 30); do
    if docker exec "$CID" sh -c "$HEALTH_CMD" >/dev/null 2>&1; then
      echo "  Health OK after ${i}s"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "  Timed out waiting for health"
      exit 1
    fi
    sleep 1
  done
else
  for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      echo "  Health OK after ${i}s"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "  Timed out waiting for health"
      exit 1
    fi
    sleep 1
  done
fi

echo ""
echo "=== Asserting /api/health response fields ==="
HEALTH_JSON=$(docker exec "$CID" bun -e "const r=await fetch('http://127.0.0.1:3000/api/health');console.log(await r.text())")
echo "  $HEALTH_JSON"

echo "$HEALTH_JSON" | bun -e "
  const h = JSON.parse(await new Response(Bun.stdin.stream()).text());
  const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };
  assert(h.status === 'ok', 'status should be ok');
  assert(typeof h.version === 'string', 'version should be a string');
  assert(typeof h.apiVersion === 'number', 'apiVersion should be a number');
  assert(typeof h.commit === 'string', 'commit should be a string');
  console.log('  version=' + h.version + ' apiVersion=' + h.apiVersion + ' commit=' + h.commit);
"

echo ""
echo "=== CLI smoke: --help ==="
docker exec "$CID" bun /app/spaceduck-cli.js --help
echo "  CLI --help OK"

echo ""
echo "=== Sentinel persistence test ==="
docker exec "$CID" sh -c 'echo quack > /data/.smoke'
echo "  Wrote sentinel file"

echo ""
echo "=== Restarting container ==="
docker restart "$CID"

echo "  Waiting for health after restart..."
for i in $(seq 1 30); do
  if docker exec "$CID" sh -c "$HEALTH_CMD" >/dev/null 2>&1; then
    echo "  Health OK after restart (${i}s)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  Timed out after restart"
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== Verifying sentinel file survived restart ==="
SENTINEL=$(docker exec "$CID" sh -c 'cat /data/.smoke')
if [ "$SENTINEL" = "quack" ]; then
  echo "  Sentinel OK: $SENTINEL"
else
  echo "  FAIL: expected 'quack', got '$SENTINEL'"
  exit 1
fi
