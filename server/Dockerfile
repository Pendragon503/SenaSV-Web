FROM node:24-slim

WORKDIR /app
COPY server ./server

ENV PORT=8787
ENV DATABASE_PATH=/app/data/senasv.sqlite
EXPOSE 8787
VOLUME ["/app/data"]

CMD ["node", "server/server.mjs"]
