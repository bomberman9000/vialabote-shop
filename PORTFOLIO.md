# Case study: ViALaBote Shop

**Role / focus:** Full-stack application development and integrations  
**Repository:** [vialabote-shop](https://github.com/bomberman9000/vialabote-shop)  
**Status:** Code example. A deployed production workflow and payment processing are **not** certified by this document.

## Problem

Build a maintainable e-commerce application with a product catalogue, shopping cart, checkout and a separate administration area.

## Implementation in this repository

- Next.js 14 App Router and TypeScript for UI and backend routes
- Tailwind CSS for frontend styling
- Prisma for database models and access
- NextAuth for authentication
- Order history and product/order administration
- Payment gateway integration in application code (see README for environment configuration)

## Engineering considerations

- Environment-driven configuration for database and integration credentials
- Separating public store, account area and administrator routes
- Development seeding must not be used as production authentication
- Real transactions, webhook delivery and production authorization require independent end-to-end verification

## How to review

1. Read [README.md](README.md) for local setup and repository structure.
2. Inspect `src/app`, `src/lib` and `prisma/schema.prisma`.
3. Run the app in an isolated development environment with your own test credentials; do not use production payment keys.

## Next steps

Add approved UI screenshots, a CI badge once a verified CI workflow exists, and a short recorded end-to-end demo with synthetic data.

> This case describes the public repository only; other ViALaBote codebases and integrations are not implied to be present here.
