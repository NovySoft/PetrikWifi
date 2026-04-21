#!/bin/bash

# Enforce strict error handling
set -euo pipefail

# Configuration
LOG_FILE="/home/petrik/RADIUS/backend/logs/MAIN.log"
ERROR_LOG_FILE="/home/petrik/RADIUS/backend/logs/ERROS-MAIN.log"
exec 2>> "$ERROR_LOG_FILE"

# Sentry Configuration
SENTRY_INGEST="https://<ID>.ingest.de.sentry.io"
SENTRY_CRONS="${SENTRY_INGEST}/api/<ID>/cron/gitfetch/<KEY>/"

CHECK_IN_ID="$(uuidgen)"

curl -s -X POST "${SENTRY_CRONS}?check_in_id=${CHECK_IN_ID}&status=in_progress" > /dev/null

handle_error() {
    local line_no=$1
    local command=$2
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    echo "[$timestamp] DEBUG: Command '$command' failed on line $line_no." >> "$ERROR_LOG_FILE"
}

# Trap ERR to catch the exact command and line number before the script exits
trap 'handle_error ${LINENO} "${BASH_COMMAND}"' ERR

handle_exit() {
    local exit_code=$?
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    
    if [ $exit_code -ne 0 ]; then
        echo "[$timestamp] FATAL: Deployment sequence aborted with exit code $exit_code. Transmitting failure state to Sentry..." >> "$ERROR_LOG_FILE"
        curl -s -X POST "${SENTRY_CRONS}?check_in_id=${CHECK_IN_ID}&status=error" > /dev/null
    else
        echo "[$timestamp] INFO: Deployment completed successfully."
        curl -s -X POST "${SENTRY_CRONS}?check_in_id=${CHECK_IN_ID}&status=ok" > /dev/null
    fi
}

trap handle_exit EXIT

REPO_DIR="/home/petrik/RADIUS/"
cd "$REPO_DIR"

git fetch origin main >/dev/null

LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse origin/main)

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
    echo "[$TIMESTAMP]:Reconciling repository state and initiating deployment..." >> "$LOG_FILE"
    
    git reset --hard origin/main
    
    docker compose build
    docker compose up -d
    
    docker image prune -f

    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
    SHORT_HASH=$(git rev-parse --short HEAD)
    echo "[$TIMESTAMP]: Automated deployment successful. Repository synchronized to commit $SHORT_HASH and services restarted." >> "$LOG_FILE"
fi