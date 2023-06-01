# Specify needing NODE
#
# FROM node:latest
# the "...as local" allows multi-stage builds; see also docker-compose file
#
FROM node:16.17.0-bullseye-slim AS local

# Copy package.json only
#
WORKDIR /usr/src/app

# Install latest chrome dev package and fonts to support major charsets (Chinese, Japanese, Arabic, Hebrew, Thai and a few others)
# Note: this installs the necessary libs to make the bundled version of Chromium that Puppeteer
# installs, work.
#
# RUN apt-get update \
    # && apt-get install -y ca-certificates wget gnupg \
    # && wget --no-check-certificate -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    # && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    # && apt-get update \
    # && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    # && apt-get install -y --no-install-recommends \
    # && rm -rf /var/lib/apt/lists/*

# Bundle the app's source
# Note that .dockerignore will specify non-copied dirs.
#
COPY package*.json ./
COPY . .

# Install puppeteer so it's available in the container.
#
ARG UID=1001
ARG GID=1001
RUN groupadd -g "${GID}" pptruser \
  && useradd --create-home --no-log-init -u "${UID}" -g "${GID}" pptruser \
  && mkdir -p /home/pptruser/Downloads \
  && chown -R pptruser:pptruser /home/pptruser \
  && chown -R pptruser:pptruser .

# Run everything after as non-privileged user.
USER pptruser

# Must be done after creation of pptruser, so puppeteer will load Chromium
# into the user's home directory
#
RUN npm install

# For the TAC model, we'll want to expose a web port
#
EXPOSE 8080

# Run a normalization command, for a test
#
CMD [ "npm", "run", "create_tableau" ]
