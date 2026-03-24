#!/bin/bash
if [ "$1" = "setup" ]; then
  shift
  exec /app/scripts/setup.sh "$@"
else
  exec /usr/bin/tini -- node packages/server/src/index.js "$@"
fi
