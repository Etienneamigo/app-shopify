FROM node:20-alpine

RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy app source
COPY . .

# Generate Prisma client and build
RUN npx prisma generate
RUN npm run build

CMD ["npm", "run", "docker-start"]
