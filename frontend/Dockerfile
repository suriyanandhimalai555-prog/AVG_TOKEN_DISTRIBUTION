# Build Stage
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

# Production API base URL
ARG VITE_API_URL=https://api.holderforge.io
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# Validate production API URL exists in generated frontend
RUN grep -R -F 'https://api.holderforge.io' dist/ \
    >/dev/null || \
    (echo "ERROR: Production API URL missing from frontend build" && exit 1)

# Production Stage
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
