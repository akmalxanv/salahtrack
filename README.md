# SalahTrack

A modern, production-grade Muslim prayer tracking and personal accountability web application built with Full-Stack Next.js 16 (App Router), React 19, Tailwind CSS v4, and MongoDB Atlas (Mongoose).

## 🚀 Getting Started

The project is structured directly at the repository root.

### 1. Environment Setup
Copy the example environment configuration and specify your MongoDB Atlas connection URI:
```bash
cp .env.example .env.local
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for Production
```bash
npm run build
npm run start
```

### 5. Run Linting & Type Checking
```bash
npm run lint
```

## 📁 Project Structure

```text
salahtrack/
├── AGENTS.md               # Master engineering & architectural guidelines
├── .env.example            # Public environment variable template
├── src/
│   ├── app/                # Next.js App Router pages, layout, and API route handlers
│   │   └── api/            # Serverless backend API routes (e.g. prayer-times)
│   ├── components/         # Reusable UI components (Sidebar, BottomNav, LanguageSelector)
│   ├── config/             # Navigation and app configuration
│   ├── context/            # React context providers (LanguageContext)
│   ├── hooks/              # Custom React hooks (useLocalStorage)
│   ├── lib/                # Shared utilities & database clients (db.ts)
│   ├── locales/            # Trilingual dictionaries (uz, ru, en)
│   └── types/              # Domain models and TypeScript type definitions
├── public/                 # Static assets (icons, SVGs, favicon)
├── package.json            # Scripts and project dependencies
├── tsconfig.json           # TypeScript path mappings and compiler options
├── next.config.ts          # Next.js configuration
├── postcss.config.mjs      # Tailwind CSS / PostCSS configuration
└── eslint.config.mjs       # ESLint rules and ignores
```
