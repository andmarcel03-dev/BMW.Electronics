#!/bin/sh
# mgu-deploy "check", after the install: the unpacked node starts on the unit (its loader and glibc), reports
# v22.23.4 and has its crypto. Offline on purpose; a failure rolls the install back.
exec "$(dirname "$0")/bin/node" -e 'process.exit(process.version === "v22.23.4" && require("crypto").getHashes().indexOf("sha256") >= 0 ? 0 : 1)'
