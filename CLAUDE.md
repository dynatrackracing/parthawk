# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Parthawk is an automotive parts inventory management platform with market intelligence features. It integrates eBay, LKQ junkyards, and competitor data through APIs and web scraping. Deployed on Railway.app.

## Tech Stack

- **Backend:** Node.js 18.x, Express.js, PostgreSQL (prod) / SQLite (dev), Knex.js + Objection.js ORM
- **Frontend:** React 17, React Router v5, Tailwind CSS v2, Formik/Yup, Chart.js, React Bootstrap
- **Auth:** Firebase (both admin SDK on server, client SDK on frontend)
- **Scraping:** Playwright + Puppeteer for browser automation, Cheerio for HTML parsing
- **Testing:** Jasmine (backend), Playwright (e2e), React Testing Library (frontend)

## Common Commands

```bash
# Install all dependencies (root + client)
npm install && cd client && npm install && cd ..

# Start backend server (port 9000)
npm start

# Start frontend dev server (port 3000, proxies to backend)
cd client && npm start

# Build frontend for production
cd client && npm run build

# Run backend tests (Jasmine)
cd service && npx jasmine

# Run e2e tests (requires app running on port 3001)
npx playwright test

# Run a single e2e test
npx playwright test e2e/<test-file>.spec.js

# Run database migrations
# Migrations run automatically on server start via service/index.js
# Manual: npx knex migrate:latest --knexfile service/database/knexfile.js
```

## Architecture

### Monorepo Layout

- `service/` — Express backend (API, scraping, cron jobs)
- `client/` — React frontend (CRA with Craco for Tailwind)
- `e2e/` — Playwright end-to-end tests
- Root `package.json` handles deployment build; client has its own `package.json`

### Backend Layers (`service/`)

Request flow: **Routes → Managers → Services/Models → Database**

- `routes/` — Express route handlers (16 modules: items, users, intelligence, pricing, yards, cogs, etc.)
- `managers/` — Business logic orchestration (ItemDetailsManager, MarketResearchManager, SellerItemManager, etc.)
- `services/` — Domain services (PriceCheckService, PricingService, DemandAnalysisService, COGSService, etc.)
- `models/` — Objection.js ORM models (Item, Auto, User, Competitor, SoldItem, etc.)
- `middleware/` — Firebase auth middleware, CacheManager, EbayQueryCacheManager
- `scrapers/` — LKQScraper (Puppeteer-based junkyard inventory scraper)
- `lib/` — CronWorkRunner (eBay seller processing), PriceCheckCronRunner, Logger (Bunyan → logs/dynatrack.log)
- `database/migrations/` — 23 Knex migrations

### Frontend Structure (`client/src/`)

- `components/` — Reusable UI (Header, Sidebar, Table, Modal, item forms)
- `components/intelligence/` — Market intelligence dashboards (10+ views: PriceCheck, DemandDashboard, CompetitorListings, etc.)
- `pages/` — Login, Verification, Admin, Payment
- `context/` — React Context providers (UserData, Item, Grid) — no Redux
- `layouts/` — Layout wrappers
- `firebase/` — Firebase client config
- `styles/` — SCSS + Tailwind hybrid

### Cron Jobs (scheduled in `service/index.js`)

- eBay seller processing — every 6 hours
- Weekly price check — Sunday 2 AM
- Nightly LKQ scrape — 2 AM
- CronWorkRunner uses async-lock to prevent concurrent runs

### Key Patterns

- Firebase handles auth; server middleware validates Firebase tokens and checks user verification status
- eBay API calls are cached in-memory (CacheManager) to avoid rate limiting
- The server serves the React SPA as a fallback route in production
- Database connection uses `DATABASE_URL` env var in production (PostgreSQL with SSL)
- Environment config via `.env` (see `.env.example` for required variables: DB creds, eBay API keys, Firebase service account)

## UI Modernization (In Progress)

Active migration from pill-shaped/gradient styling to clean modern design using Tailwind utilities. Design tokens: `rounded-lg` buttons, visible input borders with focus rings, white cards with subtle shadows. See `docs/UI_MODERNIZATION_PLAN.md` for details on completed and remaining pages.
