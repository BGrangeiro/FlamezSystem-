FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5177 DATA_DIR=/var/lib/flamez
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /var/lib/flamez && chown node:node /var/lib/flamez
USER node
EXPOSE 5177
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:5177/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
