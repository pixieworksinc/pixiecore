# Build from public source. Default mode is offline; live mode is explicit.
FROM node:24-alpine3.23 AS runtime-build
WORKDIR /app
COPY package.json package-lock.json tsconfig*.json ./
RUN npm ci --ignore-scripts --no-audit --fund=false
COPY src/ src/
COPY schemas/ schemas/
COPY scripts/ scripts/
COPY examples/integrations/drupal/ examples/integrations/drupal/
COPY examples/demo/build-runtime.mjs examples/demo/build-runtime.mjs
COPY examples/pixieagent/luna.ts examples/pixieagent/luna.ts
RUN npm run build && node examples/demo/build-runtime.mjs \
    && npm prune --omit=dev --ignore-scripts --no-audit --fund=false
COPY examples/demo/assets/ /assets/
RUN cd /assets && npm ci --ignore-scripts --no-audit --fund=false

FROM drupal:11.4.12-php8.4-fpm-alpine3.23 AS site-build
WORKDIR /site
COPY examples/demo/site/composer.json examples/demo/site/composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress \
    && composer check-platform-reqs --no-dev
COPY examples/integrations/drupal/pixiecore_integration/ web/modules/custom/pixiecore_integration/
COPY examples/integrations/drupal/pixiecore_specification/ web/modules/custom/pixiecore_specification/
COPY --from=runtime-build /assets/node_modules/codemirror/ web/libraries/codemirror/
COPY examples/demo/settings.php web/sites/default/settings.php
RUN mkdir -p /state/files && rm -rf web/sites/default/files \
    && ln -s /state/files web/sites/default/files

FROM drupal:11.4.12-php8.4-fpm-alpine3.23 AS assembled
RUN apk add --no-cache nginx bash tini libstdc++ util-linux \
    && rm -rf /opt/drupal && mkdir -p /state /demo/public \
    && chown www-data:www-data /state
COPY --from=runtime-build /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime-build /app/package.json /app/package-lock.json /runtime/
COPY --from=runtime-build /app/node_modules/ /runtime/node_modules/
COPY --from=runtime-build /app/dist/ /runtime/dist/
COPY --from=runtime-build /app/schemas/ /runtime/schemas/
COPY --from=runtime-build /app/build/demo/executable-specification/ /runtime/examples/integrations/drupal/executable-specification/
COPY --from=runtime-build /app/build/demo/pixiecore_specification/blueprints/ /runtime/examples/integrations/drupal/pixiecore_specification/blueprints/
COPY --from=runtime-build /app/build/demo/pixieagent/ /runtime/examples/pixieagent/
COPY --from=site-build /site/ /opt/drupal/
COPY examples/pixieagent/demo/replay/public/ /demo/public/pixieagent/
COPY examples/demo/public/ /demo/public/
COPY examples/demo/nginx.conf /etc/nginx/nginx.conf
COPY examples/demo/php-fpm.conf /usr/local/etc/php-fpm.d/zz-demo.conf
COPY examples/demo/start.sh examples/demo/bootstrap.php examples/demo/configure-theme.php /demo/
COPY examples/demo/runtime.mjs /runtime/examples/demo/runtime.mjs
COPY LICENSE THIRD_PARTY_NOTICES.md /demo/
RUN chmod 755 /demo/start.sh && chmod 644 /opt/drupal/web/sites/default/settings.php
# Flatten the assembled official-image filesystem so the superseded Drupal tree
# is not retained as a second copy in the exported image layers.
FROM scratch AS demo
COPY --from=assembled / /
WORKDIR /opt/drupal
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/drupal/vendor/bin \
    PHP_INI_DIR=/usr/local/etc/php \
    NODE_ENV=production HOME=/tmp DEMO_HOSTS=localhost,127.0.0.1 DEMO_USER=demo
USER www-data
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--", "/demo/start.sh"]

# Only this small gateway has a published port. The application stays internal.
FROM nginx:stable-alpine AS web
COPY examples/demo/web.conf /etc/nginx/nginx.conf
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-e", "/dev/stderr", "-g", "daemon off;"]
