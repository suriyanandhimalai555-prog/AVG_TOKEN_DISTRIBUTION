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

# Compile the contracts at build time. scripts/distribute.ts reads the ABIs
# from artifacts/, and `hardhat run` (Deploy MultiSender) finds them up to
# date instead of downloading a compiler inside the running pod.
RUN npx hardhat compile


# Production
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4002

COPY package*.json ./

COPY --from=deps /app/node_modules ./node_modules

COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
# The scripts run through ts-node and import shared code from src/
# (scripts/prepare-distribution.ts and distribute.ts: src/lib/distributionBatching).
COPY --from=build /app/src ./src
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/artifacts ./artifacts
COPY --from=build /app/cache ./cache
# The solc build Hardhat downloaded, so a recompile never needs the network.
COPY --from=build /root/.cache/hardhat-nodejs /root/.cache/hardhat-nodejs
COPY --from=build /app/hardhat.config.ts ./hardhat.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/tsconfig.build.json ./tsconfig.build.json
COPY --from=build /app/remappings.txt ./remappings.txt
COPY --from=build /app/migrations ./migrations

RUN mkdir -p /app/output

EXPOSE 4002

CMD ["node", "dist/index.js"]
