FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
# Only the pinned Node binary's embedded public Mozilla roots; no host/system CA input.
RUN node -e 'const fs=require("node:fs");fs.mkdirSync("/etc/ssl/certs",{recursive:true});fs.writeFileSync("/etc/ssl/certs/ca-certificates.crt",require("node:tls").rootCertificates.join("\n")+"\n",{mode:0o444});'
WORKDIR /opt/rsi
ENV COREPACK_NPM_REGISTRY=https://registry.npmjs.org
COPY package.json pnpm-lock.yaml ./
# Only existing locked dependencies. No package lifecycle scripts or candidate.
RUN corepack pnpm --version && corepack pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org
COPY native-wrapper.mjs ./
RUN chmod -R a+rX,a-w /opt/rsi
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/node", "/opt/rsi/native-wrapper.mjs"]
