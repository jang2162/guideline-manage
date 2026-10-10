# 지침 서버 이미지. Komodo 가 저장소를 clone 해 이 파일로 빌드한다(compose.yaml 의 pull_policy: build).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package.json ./
COPY cli/src ./cli/src
COPY locales ./locales
COPY server/bin ./server/bin
COPY server/src ./server/src
COPY server/static ./server/static
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/bin/guideline-server.js"]
