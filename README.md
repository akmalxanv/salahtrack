# SalahTrack

A modern, production-grade Muslim prayer tracking and personal accountability web application built with Next.js (App Router), React, and Tailwind CSS.

## 🚀 Getting Started

The project is structured directly at the repository root.

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Build for Production
```bash
npm run build
npm run start
```

### 4. Run Linting
```bash
npm run lint
```

## 📁 Project Structure

```text
salahtrack/
├── AGENTS.md               # Master engineering & architectural guidelines
├── src/
│   ├── app/                # Next.js App Router pages and layout
│   ├── components/         # Reusable UI components (Sidebar, BottomNav, LanguageSelector)
│   ├── config/             # Navigation and app configuration
│   ├── context/            # React context providers (LanguageContext)
│   ├── hooks/              # Custom React hooks (useLocalStorage)
│   ├── locales/            # Multilingual translations (ru, en, uz)
│   └── types/              # Domain models and TypeScript type definitions
├── public/                 # Static assets (icons, SVGs, favicon)
├── package.json            # Scripts and project dependencies
├── tsconfig.json           # TypeScript path mappings and compiler options
├── next.config.ts          # Next.js configuration
├── postcss.config.mjs      # Tailwind CSS / PostCSS configuration
└── eslint.config.mjs       # ESLint rules and ignores
```
