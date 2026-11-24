#!/bin/sh
# Server-side deploy for the SalahTrack Telegram bot.
#
# Installed on the server as /usr/local/bin/salahtrack-bot-deploy and bound to the
# GitHub Actions SSH key with a forced command in /root/.ssh/authorized_keys:
#   command="/usr/local/bin/salahtrack-bot-deploy",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 ... github-actions-salahtrack-bot
# so that key can do nothing except run this script.
#
# Input: a tar archive of the bot's source on stdin (sent by .github/workflows/bot-deploy.yml).
# Secrets (.env.bot) stay on the server and are never part of the archive.
set -eu

APP_DIR=/opt/salahtrack-bot
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

# Reject anything that is not the expected archive (limit 50 MB)
head -c 52428800 | tar -x -C "$STAGE"
for f in Dockerfile.bot docker-compose.bot.yml package.json package-lock.json bot/index.ts; do
  [ -f "$STAGE/$f" ] || { echo "deploy: archive is missing $f" >&2; exit 1; }
done
[ ! -e "$STAGE/.env.bot" ] || { echo "deploy: archive must not contain .env.bot" >&2; exit 1; }

# Swap in the new source; .env.bot in APP_DIR is preserved
cd "$APP_DIR"
rm -rf src bot
cp -a "$STAGE"/. "$APP_DIR"/

docker compose -f docker-compose.bot.yml up -d --build --remove-orphans
docker image prune -f >/dev/null

# Fail the deploy if the container does not stay up
sleep 10
if [ "$(docker inspect -f '{{.State.Running}}' salahtrack-bot 2>/dev/null)" != "true" ]; then
  echo "deploy: container is not running" >&2
  docker logs --tail 30 salahtrack-bot >&2 || true
  exit 1
fi
docker logs --tail 5 salahtrack-bot
echo "deploy: OK"
