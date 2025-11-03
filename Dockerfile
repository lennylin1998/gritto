FROM node:24
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]