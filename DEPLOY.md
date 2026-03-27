# Deployment Guide - IONOS Ubuntu 24.04

## Prerequisites

- Ubuntu 24.04 server (IONOS VPS)
- Domain name pointing to your server
- Docker & Docker Compose installed

## 1. Install Docker on Ubuntu 24.04

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y
```

## 2. Clone and Configure

```bash
# Clone the repository
git clone https://github.com/Etienneamigo/app-shopify.git
cd app-shopify

# Checkout the correct branch
git checkout feature/custom-reviews-system

# Create environment file from example
cp .env.example .env
```

## 3. Edit `.env` with your actual values

```bash
nano .env
```

Fill in:
- `SHOPIFY_API_KEY` - from your Shopify Partners dashboard
- `SHOPIFY_API_SECRET` - from your Shopify Partners dashboard
- `SHOPIFY_APP_URL` - your public URL (e.g., https://reviews.yourdomain.com)
- `POSTGRES_PASSWORD` - choose a strong password
- Update `DATABASE_URL` to match your password

## 4. Deploy with Docker Compose

```bash
# Build and start all services
docker compose up -d --build

# Check logs
docker compose logs -f app

# Verify the database migration ran
docker compose exec app npx prisma migrate status
```

## 5. Set up HTTPS with Nginx (recommended)

```bash
# Install Nginx and Certbot
sudo apt install nginx certbot python3-certbot-nginx -y

# Create Nginx config
sudo nano /etc/nginx/sites-available/reviews-app
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name reviews.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/reviews-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d reviews.yourdomain.com
```

## 6. Configure Shopify App

In your Shopify Partners dashboard:
1. Set **App URL** to `https://reviews.yourdomain.com`
2. Set **Allowed redirection URL(s)** to `https://reviews.yourdomain.com/api/auth`
3. Configure **App Proxy**:
   - Sub path prefix: `apps`
   - Sub path: `reviews`
   - Proxy URL: `https://reviews.yourdomain.com/api/reviews`

## 7. Deploy the theme extension

```bash
# From your local machine (not the server)
npm run deploy
```

## Useful Commands

```bash
# Restart services
docker compose restart

# View logs
docker compose logs -f app
docker compose logs -f db

# Access database directly
docker compose exec db psql -U reviews_user -d reviews_db

# Run Prisma commands
docker compose exec app npx prisma studio
docker compose exec app npx prisma migrate status

# Rebuild after code changes
git pull
docker compose up -d --build

# Full reset (WARNING: deletes all data)
docker compose down -v
docker compose up -d --build
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   IONOS VPS                      │
│                                                  │
│  ┌──────────┐     ┌──────────┐    ┌──────────┐ │
│  │  Nginx   │────▶│  Node.js │───▶│ Postgres │ │
│  │  (SSL)   │     │  App     │    │  DB      │ │
│  │  :443    │     │  :3000   │    │  :5432   │ │
│  └──────────┘     └──────────┘    └──────────┘ │
│                                                  │
└─────────────────────────────────────────────────┘
         ▲                ▲
         │                │
    Storefront      Shopify Admin
    (App Proxy)     (Embedded App)
```
