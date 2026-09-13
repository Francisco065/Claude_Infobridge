FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Variáveis NEXT_PUBLIC_* são embutidas no bundle durante o build — precisam
# chegar como build args, não só como variáveis de execução do container.
ARG NEXT_PUBLIC_TILE_KEY
ARG NEXT_PUBLIC_TILE_URL_ROADMAP
ARG NEXT_PUBLIC_TILE_URL_SATELLITE
ARG NEXT_PUBLIC_TILE_ATTR_ROADMAP
ARG NEXT_PUBLIC_TILE_ATTR_SATELLITE
ENV NEXT_PUBLIC_TILE_KEY=$NEXT_PUBLIC_TILE_KEY \
    NEXT_PUBLIC_TILE_URL_ROADMAP=$NEXT_PUBLIC_TILE_URL_ROADMAP \
    NEXT_PUBLIC_TILE_URL_SATELLITE=$NEXT_PUBLIC_TILE_URL_SATELLITE \
    NEXT_PUBLIC_TILE_ATTR_ROADMAP=$NEXT_PUBLIC_TILE_ATTR_ROADMAP \
    NEXT_PUBLIC_TILE_ATTR_SATELLITE=$NEXT_PUBLIC_TILE_ATTR_SATELLITE

RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
