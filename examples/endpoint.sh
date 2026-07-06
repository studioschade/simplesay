#!/bin/bash

# SimpleSay Mock Endpoint
# Usage: ./endpoint.sh [--agent <name>] "<text>"

AGENT_NAME="unknown"

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --agent) AGENT_NAME="$2"; shift ;;
        *) TEXT="$1" ;;
    esac
    shift
done

if [ -z "$TEXT" ]; then
    echo "Error: No text provided."
    exit 1
fi

echo "[Endpoint] Agent: $AGENT_NAME"
echo "[Endpoint] Speaking: $TEXT"

# Use the system 'say' command (common on macOS)
# On Linux, you might use 'espeak' or 'spd-say'
if command -v say &> /dev/null; then
    say "$TEXT"
elif command -v espeak &> /dev/null; then
    espeak "$TEXT"
elif command -v spd-say &> /dev/null; then
    spd-say "$TEXT"
else
    echo "[Endpoint] No TTS command found (say, espeak, spd-say). Text: $TEXT"
fi
