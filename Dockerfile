FROM node:lts-alpine AS deps
WORKDIR /usr/src/app
COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install --silent

FROM deps AS builder
WORKDIR /usr/src/app
COPY . .
RUN npm run build:web

FROM node:lts-alpine AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV PORT=3017
ARG APP_ROLE=web
ENV APP_ROLE=${APP_ROLE}
COPY --from=builder /usr/src/app /usr/src/app
RUN chown -R node:node /usr/src/app
USER node
EXPOSE 3017
CMD ["sh", "-c", "if [ \"$APP_ROLE\" = \"worker\" ]; then npm run swarm:worker; else npm run start:web; fi"]

