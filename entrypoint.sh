#!/bin/bash

# Add local user
# Either use the LOCAL_USER_ID if passed in at runtime or
# fallback

UID=${LOCAL_USER_ID:-1001}
GID=${LOCAL_GROUP_ID:-1001}

echo "Starting with UID : $UID"
# useradd --shell /bin/bash -u $UID -o -c "" -m user

groupadd -g "${GID}" pptruser
useradd --create-home --no-log-init -u "${UID}" -g "${GID}" pptruser
mkdir -p /home/pptruser/Downloads
chown -R pptruser:pptruser /home/pptruser
chown -R pptruser:pptruser .

export HOME=/home/user

# Change ownership of reports folder
#
# echo "run chown to id : $UID"
# chown $UID /usr/src/app/src/static/data
# chown $UID /usr/src/app/src/static/data/reports

exec /usr/local/bin/gosu pptruser "$@"
