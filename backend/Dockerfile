# Build Stage
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build


# Production Stage
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4002

COPY package*.json ./

# Runtime scripts use ts-node, so keep the complete dependency tree.
RUN npm ci

COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/hardhat.config.ts ./hardhat.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/tsconfig.build.json ./tsconfig.build.json
COPY --from=build /app/remappings.txt ./remappings.txt

# Runtime-generated files
RUN mkdir -p /app/output /app/cache

EXPOSE 4002

CMD ["node", "dist/index.js"]
