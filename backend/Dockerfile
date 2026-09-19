# Dependencies
FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci


# Build
FROM deps AS build

WORKDIR /app

COPY . .

RUN npm run build


# Production
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4002

COPY package*.json ./

COPY --from=deps /app/node_modules ./node_modules

COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/hardhat.config.ts ./hardhat.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/tsconfig.build.json ./tsconfig.build.json
COPY --from=build /app/remappings.txt ./remappings.txt

RUN mkdir -p /app/output /app/cache

EXPOSE 4002

CMD ["node", "dist/index.js"]
