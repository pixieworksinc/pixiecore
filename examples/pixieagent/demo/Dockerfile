# Build from the repository root, using the public checkout's locked dependencies.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig*.json ./
RUN npm ci --ignore-scripts --no-audit --fund=false
COPY src/ src/
COPY schemas/ schemas/
COPY scripts/ scripts/
COPY examples/pixieagent/ examples/pixieagent/
RUN npm run build && node examples/pixieagent/demo/build-runtime.mjs \
    && npm prune --omit=dev --ignore-scripts --no-audit --fund=false

FROM node:24-bookworm-slim AS live
ENV NODE_ENV=production TRIAL_CONFIG=/run/trial/config.json
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/dist/ dist/
COPY --from=build /app/schemas/ schemas/
COPY --from=build /app/build/pixieagent/ examples/pixieagent/
COPY examples/pixieagent/agent.yaml examples/pixieagent/agent.yaml
COPY examples/pixieagent/blueprints/ examples/pixieagent/blueprints/
COPY examples/pixieagent/evaluation/cases.json examples/pixieagent/evaluation/cases.json
COPY examples/pixieagent/evaluation/fixtures.json examples/pixieagent/evaluation/fixtures.json
COPY examples/pixieagent/demo/live/ examples/pixieagent/demo/live/
COPY examples/pixieagent/demo/container-http.test.mjs examples/pixieagent/demo/container-http.test.mjs
COPY examples/pixieagent/demo/container-test.mjs examples/pixieagent/demo/container-test.mjs
COPY examples/pixieagent/demo/write-manifest.mjs examples/pixieagent/demo/write-manifest.mjs
COPY examples/pixieagent/tests/deny-network.mjs examples/pixieagent/tests/deny-network.mjs
COPY LICENSE THIRD_PARTY_NOTICES.md ./
RUN node examples/pixieagent/demo/write-manifest.mjs \
    && mkdir /state && chown node:node /state
USER node
EXPOSE 3098
ENTRYPOINT ["node"]
CMD ["examples/pixieagent/demo/live/start.mjs"]

# The default image serves only fixture replay; it contains no provider runtime.
FROM nginx:stable-alpine AS web
COPY examples/pixieagent/demo/nginx.conf /etc/nginx/nginx.conf
COPY examples/pixieagent/demo/replay/public/ /usr/share/nginx/html/pixieagent/
COPY examples/pixieagent/demo/live/public/ /usr/share/nginx/html/pixieagent/live/
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
