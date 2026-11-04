# Copyright (c) 2026 Garry Tan. MIT License.
# Mutation tool image for TypeScript (outcome-per-skill plan v3, section 10): StrykerJS 10.1.1 with its vitest runner,
# Apache-2.0, from a frozen lockfile. vitest itself is left out (legacy peer deps): the scorer links the project's own
# vitest in, so the runner drives the version and config the project tests with. fixture-node holds vitest 4.1.12 for
# the fixture images only. bin/ps stands in for procps, which Stryker needs and slim images lack. git is here for the fixture images that start from this one.
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
RUN apt-get update && apt-get install -y --no-install-recommends git=1:2.39.5-0+deb12u3 && rm -rf /var/lib/apt/lists/*
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
COPY node-package.json /opt/gstack-mutation/node/package.json
COPY node-package-lock.json /opt/gstack-mutation/node/package-lock.json
COPY node-ps.sh /opt/gstack-mutation/node/bin/ps
COPY fixture-node-package.json /opt/gstack-mutation/fixture-node/package.json
COPY fixture-node-package-lock.json /opt/gstack-mutation/fixture-node/package-lock.json
RUN cd /opt/gstack-mutation/node && npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund \
 && cd /opt/gstack-mutation/fixture-node && npm ci --ignore-scripts --no-audit --no-fund \
 && mkdir -p /opt/gstack-mutation/node/licence \
 && node -e "const fs=require('fs');const d='/opt/gstack-mutation/node/node_modules/@stryker-mutator/';const l=['core','vitest-runner'].map(p=>{const j=require(d+p+'/package.json');if(j.version!=='10.1.1')throw new Error(p+' '+j.version);return j.license});if(new Set(l).size!==1)throw new Error(l.join());fs.writeFileSync('/opt/gstack-mutation/node/licence/spdx.txt',l[0]+'\n');fs.copyFileSync(d+'core/LICENSE','/opt/gstack-mutation/node/licence/LICENSE')" \
 && rm -rf /root/.npm
