# GEAR Service Center - container image for cloud hosting
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production \
    PORT=3000 \
    GEAR_DATA_DIR=/data \
    TRUST_PROXY=1
# Mount a persistent volume here so the database and photos survive restarts
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server/server.js"]
