#!/usr/bin/env bash
# macOS: double-click this file in Finder.
cd "$(dirname "$0")" || exit 1
./start.sh "$@"
status=$?
if [ $status -ne 0 ]; then read -r -p "اضغط Enter للخروج..." _; fi
exit $status
