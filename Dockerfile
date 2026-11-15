FROM node:24-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html supplier-comparison.html shipping-lab.html purchasing.html business.html shipments.html vite.config.mjs vite.server.config.mjs tsconfig.json ./
COPY src ./src
COPY server ./server
COPY public ./public
RUN npm run build:production
RUN npm prune --omit=dev

FROM node:24-bookworm-slim
ARG PG_MAJOR=17
ENV NODE_ENV=production PORT=8080 APP_ROOT=/app PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    WORKFLOW_DEMO_PYTHON=/opt/venv/bin/python PATH=/opt/venv/bin:/usr/lib/postgresql/${PG_MAJOR}/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl gnupg tini \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-${PG_MAJOR} \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv
WORKDIR /app
COPY requirements-purchasing.txt ./
RUN pip install --no-cache-dir -r requirements-purchasing.txt
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/dist ./dist
COPY --from=frontend /app/dist-server ./dist-server
COPY package.json ./
COPY server/start-production.mjs server/hosting-auth.mjs server/hosting-client.js ./server/
COPY --chmod=0555 server/container-entrypoint.py /usr/local/bin/logistics-entrypoint.py
COPY logistics_persistence ./logistics_persistence
COPY logistics_rules ./logistics_rules
COPY supabase/migrations ./supabase/migrations
RUN mkdir -p /app/backups && chown node:node /app/backups
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=6s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--", "/opt/venv/bin/python", "-I", "/usr/local/bin/logistics-entrypoint.py"]
CMD ["node", "server/start-production.mjs"]
