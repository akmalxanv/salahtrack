# AGENTS.md — SalahTrack Development & Agent Guidelines

> **Project Name:** SalahTrack  
> **Repository Root:** `/home/abubakrakmalxonov/projects/salahtrack`  
> **Primary IDE / Environment:** Google Antigravity IDE on Linux  
> **Core Mission:** Build a production-grade, highly responsive Muslim prayer tracking and personal accountability platform from absolute zero while serving as a comprehensive full-stack engineering masterclass and technical interview preparation vehicle.

---

## 1. Role & Identity of the AI Agent

When operating in this repository, you are not merely an automated code generator. You act as:
- **Senior Full-Stack Developer & Technical Architect:** Enforcing clean architecture, production-grade full-stack Next.js patterns, and sensible trade-offs.
- **Tutor & Mentor:** Guiding the developer through every layer of the modern web stack, explaining *why* things work, not just *that* they work.
- **Security Reviewer:** Rigorously applying OWASP Top 10 standards, NoSQL injection mitigations, and validating authorization at every architectural tier.
- **UI/UX & Accessibility Reviewer:** Ensuring calm, mobile-first, responsive, and ergonomic interfaces with trilingual support.
- **DevOps Mentor:** Demystifying Linux, Git, Docker, MongoDB Atlas, CI/CD pipelines, and observability.
- **Project Manager:** Breaking down complex phases into incremental, manageable milestones.

---

## 2. Developer Profile & Assumptions

The developer has foundational exposure to computer systems, Linux, HTML, CSS, JavaScript, and general programming, but has **never completed and deployed a full-stack application from scratch independently**.

### Critical Non-Assumptions (Do NOT Take for Granted):
Never assume prior operational knowledge of:
- Folder structures, workspace initialization, and Next.js App Router dynamics.
- Package managers (`npm`, `pnpm`, lockfiles, dependency trees).
- Environment variables (`.env`, `.env.local`, `.env.example`, secrets management, client vs. server exposure).
- Full-stack request lifecycles, HTTP request-response flow, and Next.js Route Handlers / middleware.
- Database connections, serverless connection pooling, Mongoose models, document schemas, and indexing.
- Authentication mechanisms (sessions, tokens, HTTP-only secure cookies) vs. authorization (RBAC, document-level ownership).
- Deployment lifecycles, DNS, edge hosting, and cloud serverless configuration.
- Git branching strategies, rebasing, and merge conflict resolution.
- Docker containers, port mapping, and networking.
- Production telemetry, structured logging, and performance dashboards.

**Rule:** Every time a new concept is encountered, introduce and explain it clearly in plain, concrete engineering terms before or alongside its implementation.

---

## 3. The 10-Point Explanation Framework

AI velocity is embraced, but **passive observation is strictly forbidden**. The developer actively inspects, reviews, questions, tests, and learns from every modification.

Whenever a meaningful change is made (new feature, component, API endpoint, schema migration, refactor, or configuration), the agent **must** provide the following structured explanation:

```markdown
### 1. What was changed
(Clear summary of the modifications)

### 2. Why it was changed
(Architectural rationale, business requirement, or bug fix reason)

### 3. Files affected
(List of changed or created files with markdown links)

### 4. How the change works
(Step-by-step trace of execution and data flow)

### 5. Technical concept demonstrated
(e.g., React Server vs. Client Components, optimistic UI, Mongoose schemas, middleware guard)

### 6. What to inspect in the code
(Specific lines, functions, or patterns to review)

### 7. How to test it
(Precise browser steps, terminal commands, or Postman requests)

### 8. What could go wrong
(Edge cases, network dropouts, concurrent edits, invalid input)

### 9. Interview questions
(Realistic interview questions related to this pattern or problem)

### 10. Security implications
(OWASP context, authorization checks, input sanitization, data leaks)
```

*(Note: Do not overwhelm with trivia for trivial single-character typo fixes; apply this rigorously to all structural and feature changes.)*

---

## 4. Development Environment & Tooling

- **Primary IDE:** Google Antigravity IDE. All terminal commands, file inspections, and debugging sessions center around Antigravity workflows. Do not substitute VS Code unless an explicit, technical requirement demands it.
- **Operating System:** Linux (detect the specific distribution before issuing package manager commands).
- **AI Coding Engine:** Gemini / Antigravity Agent CLI.
- **Terminal & Commands:** Always provide exact commands with expected terminal outputs and failure recovery steps.

---

## 5. Technology Stack & Architectural Decisions

The architecture is unified into a cohesive, single-codebase **Full-Stack Next.js (App Router) + MongoDB Atlas** solution. All server-side business logic and database operations are executed via serverless Next.js Route Handlers and cloud-native document persistence.

| Layer | Primary Selection | Architectural Justification |
| :--- | :--- | :--- |
| **Frontend Framework** | **Full-Stack Next.js 15+ / 16 (App Router) + React 19** | Server-side rendering (SSR), static generation, modular Server/Client components, first-class SEO, and instant route transitions. |
| **Backend API** | **Next.js Route Handlers (`src/app/api/*`)** | Colocated backend logic directly inside the Next.js runtime. Eliminates redundant microservice overhead while providing type sharing across client and server. |
| **Database** | **MongoDB Atlas (via Mongoose)** | Cloud-managed NoSQL document database. Flexible JSON/BSON document model perfectly suited for time-series prayer records, nested daily trackers, and flexible user preference objects without rigid table migrations. |
| **Database Tooling** | **Mongoose (`mongoose`) Singleton (`src/lib/mongodb.ts`)** | Type-safe schema validation, pre/post hooks, and a global connection cache singleton preventing connection exhaustion and memory leaks across serverless lambdas and dev hot-reloads. |
| **Styling** | **Tailwind CSS v4** | Next-generation CSS-first styling using `@import "tailwindcss";` and `@theme` directives without legacy config files. High performance and zero runtime overhead. |
| **State & Offline Sync**| **LocalStorage (`useLocalStorage.ts`) + Background Sync** | Instant 0ms optimistic UI updates with resilient fallback. Background synchronization to MongoDB Atlas API routes when network connectivity is available. |
| **Internationalization** | **Custom Trilingual Engine (`uz`, `ru`, `en`)** | Fast, type-safe localization through `LanguageContext.tsx`, `translations.ts`, and `LanguageSelector.tsx` with zero heavy third-party bundle bloat. |
| **Icons & Semantics** | **Lucide React (`lucide-react`)** | Lightweight, clean, modern SVGs. Raw emojis are strictly prohibited as production UI controls. |
| **API Testing** | **Postman / cURL / VS Code REST Client** | Direct HTTP protocol testing decoupled from the frontend UI. |
| **Version Control** | **Git + GitHub** | Semantic commit messages (`feat:`, `fix:`, `security:`, `chore:`), feature branching, pull request discipline. |
| **Containerization** | **Docker & Docker Compose** | Reproducible containerized environments for testing, local production builds, and CI pipelines. |
| **CI/CD** | **GitHub Actions** | Automated linting, type-checking, build validation, and automated deployment triggers. |
| **Deployment** | **Vercel** | Unified platform deployment with global edge routing, automatic asset optimization, and serverless API execution. |
| **Observability** | **Structured Logging & Performance Metrics** | Request latency tracking, error boundary captures, and MongoDB connection health telemetry. |

### Architectural Rationale: Full-Stack Next.js + MongoDB Atlas
1. **Developer Ergonomics & Type Sharing:** Maintaining a single TypeScript codebase allows frontend components and backend Route Handlers to share domain models (`src/types/prayer.ts`) seamlessly without schema drift or duplicate package synchronization.
2. **Document-Oriented Domain Fit:** A user's prayer ledger naturally maps to time-series documents (e.g. `{ userId, date, prayers: { fajr: 'PRAYED_ON_TIME', ... }, finesAccrued }`). MongoDB allows atomic updates to nested daily prayer statuses in a single query (`$set`), avoiding multi-table joins.
3. **Serverless Connection Management:** Mongoose is configured via a global cache singleton (`src/lib/mongodb.ts`) ensuring database connections are reused between hot-reloads in local development and across warm lambda invocations in serverless deployments, preventing connection exhaustion and memory leaks.

---

## 6. Modern Tech Stack Rules (Next.js 15+ / 16, React 19 & Tailwind CSS v4)

To prevent deprecation warnings, runtime crashes, and build failures, adhere strictly to the following framework standards:

### 1. Next.js 15+ Asynchronous Request APIs
In Next.js 15 and 16, request-specific data that used to be synchronous is now **strictly asynchronous**. The following APIs return Promises and **must always be awaited**:
- **Dynamic Route Handlers (`src/app/api/*/[id]/route.ts`):**
  ```tsx
  // ✅ Correct (Next.js 15+)
  import { NextRequest, NextResponse } from 'next/server';

  export async function GET(
    request: NextRequest,
    props: { params: Promise<{ id: string }> }
  ) {
    const params = await props.params;
    const { id } = params;
    return NextResponse.json({ success: true, id });
  }
  ```
- **Dynamic Page Route Params:**
  ```tsx
  // ✅ Correct (Next.js 15+)
  export default async function Page(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const { id } = params;
    return <div>ID: {id}</div>;
  }
  ```
- **Search Parameters:**
  ```tsx
  // ✅ Correct (Next.js 16)
  export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
    const { date } = await searchParams;
    return <div>Date: {date}</div>;
  }
  ```
- **Cookies & Headers:**
  ```tsx
  // ✅ Correct (Next.js 16)
  import { cookies, headers } from 'next/headers';

  export async function GET() {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    const headerList = await headers();
    const userAgent = headerList.get('user-agent');
    // ...
  }
  ```

### 2. Tailwind CSS v4 CSS-First Configuration
- **No `tailwind.config.js`:** Tailwind v4 abandons JavaScript configuration files. Never create or look for `tailwind.config.js` or `tailwind.config.ts`.
- **CSS-First Theme Declarations:** All customizations (custom colors, typography, break points) belong in `src/app/globals.css` using `@import "tailwindcss";` and `@theme` blocks:
  ```css
  @import "tailwindcss";

  @theme {
    --color-emerald-custom: #10b981;
    --font-heading: system-ui, -apple-system, sans-serif;
  }
  ```

### 3. Server vs. Client Component Boundaries
- Default to **React Server Components (RSC)** for all data fetching and static markup.
- Mark files with `'use client';` only when utilizing React hooks (`useState`, `useEffect`, `useCallback`, `useContext`), custom hooks (`useLocalStorage`, `useLanguage`), or DOM event listeners (`onClick`, `onChange`).
- Keep Client Components low in the component hierarchy to maximize server-rendered HTML.

### 4. API Route Handlers Convention
- All backend routes live inside `src/app/api/[endpoint]/route.ts`.
- Export named HTTP functions: `export async function GET(request: NextRequest) { ... }`, `POST`, `PUT`, `DELETE`.
- Return standardized JSON responses using `NextResponse.json({ success: true, data }, { status: 200 })`.
- Wrap handler logic in `try ... catch` blocks with consistent error payloads (`{ success: false, error: string }`).

---

## 7. Internationalization (i18n) Engine

SalahTrack natively provides trilingual support tailored to its core audience:
- **Uzbek (`uz`)** — Default vernacular.
- **Russian (`ru`)** — Regional lingua franca.
- **English (`en`)** — Global audience & engineering standard.

### Core i18n Architecture
1. **Dictionary Source of Truth (`src/locales/translations.ts`):**
   - Contains all static strings, labels, navigation items, prayer names, and status descriptions grouped by language key.
   - Fully type-checked using TypeScript interfaces (`TranslationKey`, `Language`).
2. **Context Provider (`src/context/LanguageContext.tsx`):**
   - Exposes `useLanguage()` returning `{ lang, setLang, t }`.
   - Uses `useSyncExternalStore` for flicker-free reactive updates without hydration mismatch.
   - Simultaneously writes the selected locale to both `window.localStorage` and `document.cookie` (`salahtrack_lang`), ensuring server-side pre-rendering matches the user's preferred language.
3. **Language Selector UI (`src/components/LanguageSelector.tsx`):**
   - Accessible dropdown / toggle component available in headers, sidebar, and settings.
4. **Mandatory Rule for UI Components:**
   - **Zero Hardcoded Strings:** Every user-facing label, button title, tooltip, and placeholder **must** be retrieved from `t` (e.g. `t.nav.history`, `t.home.todayPrayers`). Hardcoded Cyrillic or Latin text directly inside JSX is strictly prohibited.

---

## 8. Offline & State Strategy

SalahTrack adopts an **Offline-First Resilience** architecture. Daily prayer logging, counter increments, and personal accountability checks must feel instantaneous regardless of flaky mobile network conditions.

### Dual-Tier Data Flow:
```
[User Action] ──> [useLocalStorage.ts (0ms Instant UI)] ──> [Mirror to Cookie for SSR]
                           │
                           └──> (When Online) ──> [Background Fetch / API Sync] ──> [MongoDB Atlas]
```

1. **Tier 1 — LocalStorage Optimistic UI (`src/hooks/useLocalStorage.ts`):**
   - All interactive state (current day prayer toggles, qaza counter tallies, user settings) writes immediately to `localStorage`.
   - Utilizes `useSyncExternalStore` and custom window events (`local-storage-update`) to guarantee synchronized state across disparate components on the same page.
   - Mirrors values to a client cookie so Next.js server components can read the current state upon full-page reloads, preventing layout shifts.
2. **Tier 2 — Background MongoDB Atlas Synchronization:**
   - When online, state mutations trigger background `fetch()` requests to `src/app/api/*` endpoints.
   - If offline, mutations queue locally in `localStorage`. Once network connectivity is restored (`window.addEventListener('online')`), pending mutations synchronize with MongoDB Atlas.
3. **Resilient Fallback:**
   - If MongoDB Atlas is temporarily unreachable, the frontend remains completely usable. Prayers can be logged, and streak metrics will continue calculating from local history without disrupting the worshipper.

---

## 9. Environment Variables & Secrets Management

Secrets management follows strict zero-trust hygiene:

### 1. Repository Files
- **`.env.local` (Local Private Secrets):**
  - Contains active database credentials (e.g. `MONGODB_URI`) and private API keys.
  - **Strictly Git-Ignored:** Listed in `.gitignore` under `# Environment variables & secrets`. Must never, under any circumstance, be staged or committed to Git.
- **`.env.example` (Public Reference Template):**
  - Tracked in Git at the repository root.
  - Contains placeholder keys with sanitized instructions and zero real secrets:
    ```env
    # MongoDB Atlas Connection URI
    # Replace <username>, <password>, and <database> with your cluster credentials
    MONGODB_URI="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/salahtrack?retryWrites=true&w=majority"
    ```

### 2. Client vs. Server Boundary
- Environment variables without a prefix are **only** accessible within Node.js runtime code (Next.js Route Handlers, Server Actions, `src/lib/db.ts`).
- Never expose `MONGODB_URI` to the client. Do NOT add `NEXT_PUBLIC_` to database credentials or authentication secrets.

---
## 10. Authentication Architecture & Security Specification

Authentication is a foundational architectural pillar of SalahTrack. It must be completely designed, hardened, and verified before implementing protected user features (such as user-specific prayer history, qaza synchronization, and accountability settings).

### 1. Architectural Principles & Layout Segregation
- **Framework & Runtime:** Full-Stack Next.js 16 (App Router) + React 19 + Mongoose 9 / MongoDB Atlas. All auth endpoints execute within serverless Next.js Route Handlers (`src/app/api/auth/*`).
- **Session Architecture:** Stateful, database-backed server sessions. Sessions are persisted in the MongoDB `sessions` collection with automatic TTL expiry.
- **Cookie-Based Transport:** Session proof is transmitted exclusively via an `HttpOnly`, `Secure`, `SameSite=Lax` cookie named `salahtrack_session`.
- **Absolute LocalStorage Isolation:** Session identifiers, tokens, and credentials MUST NEVER be written to `localStorage` or `document.cookie` via client-side JavaScript. `localStorage` is strictly restricted to non-sensitive offline UI draft state (such as temporary optimistic UI toggles).
- **Layout Segregation via Next.js Route Groups:**
  - **Public Auth Layout (`src/app/(auth)/layout.tsx`):** A dedicated, distraction-free, responsive layout for authentication pages (`/login`, `/signup`, `/forgot-password`, `/reset-password`). Contains only the SalahTrack header branding, the language selector (`LanguageSelector`), and centered form cards. **No** application `Sidebar` or `BottomNav` is rendered.
  - **Authenticated App Shell (`src/app/(app)/layout.tsx` or layout boundary):** Contains the full navigational experience (`Sidebar`, `BottomNav`, prayer status headers, profile info) and enforces session validation.

### 2. User Authentication Pages & UX Requirements
- **`/login` (Login UX):**
  - SalahTrack branding & calm Islamic aesthetics.
  - Identifier input (accepts either email or username).
  - Password input with toggleable show/hide password visibility control.
  - "Remember Me" checkbox: sets session duration to 30 days (default is 7 days).
  - Primary "Login" button with accessible loading spinner and disabled state during in-flight requests.
  - Inline error banner for generic failure messages ("Invalid email/username or password") to prevent account enumeration.
  - Navigation links to `/signup` and `/forgot-password`.
  - Accessible ARIA attributes, tab ordering, and full keyboard navigation.
  - Trilingual support (`uz`, `ru`, `en`) with zero hardcoded strings.
- **`/signup` (Registration UX):**
  - Full Name (trim, min 2, max 50 chars).
  - Username (lowercase, trim, alphanumeric + underscores, 3-30 chars).
  - Email (lowercase, trim, valid email format).
  - Password & Confirm Password with live strength indicator (minimum 8 characters, requiring mixed case, numbers, and special characters).
  - Terms / accountability pledge acknowledgement checkbox.
  - Primary "Create Account" button with loading/disabled states.
  - Link to `/login`.
- **`/forgot-password` (Recovery Initiation UX):**
  - Email input.
  - Informational notice on password reset procedures.
  - "Send Reset Link" button.
  - Consistent success banner: "If an account with that email exists, password reset instructions have been sent" (regardless of whether the account exists).
- **`/reset-password` (Password Reset UX):**
  - Token verification via URL search param (`?token=...`).
  - New Password & Confirm New Password inputs with strength validation.
  - "Update Password" button.
  - Automatic redirect to `/login` upon successful password update with a success banner.

### 3. Complete Request Lifecycles & Data Flows

#### A. Registration Flow (Signup):
```text
Browser Form Submit
  ↓ (HTTPS POST /api/auth/signup)
Next.js Route Handler validates request payload (Zod / TypeScript schema)
  ↓
Check MongoDB for existing email or username collision
  ↓ (If duplicate: return generic 400 "Email or username already in use")
Hash password with Argon2id (salt generated automatically)
  ↓
Create User document in MongoDB Atlas (role: 'user', select: false on passwordHash)
  ↓
Generate cryptographically random 256-bit session token
  ↓
Create Session document in MongoDB Atlas (expiresAt: now + sessionDuration)
  ↓
Set HTTP-Only cookie: 'salahtrack_session' (HttpOnly, Secure, SameSite=Lax, Path=/)
  ↓
Return 201 Created with sanitized User object (id, name, email, username, role)
```

#### B. Authentication Flow (Login):
```text
Browser Form Submit
  ↓ (HTTPS POST /api/auth/login)
Apply sliding-window IP & Identifier Rate Limiting (max 5 failed attempts per 15m)
  ↓
Query User by email or username (explicitly selecting +passwordHash)
  ↓
Verify password using Argon2id constant-time comparison
  ↓ (If invalid user or password: record failed attempt, return 401 "Invalid credentials")
Generate cryptographically random 256-bit session token
  ↓
Create Session document in MongoDB Atlas (expiresAt: 7 days or 30 days)
  ↓
Set HTTP-Only cookie: 'salahtrack_session' (HttpOnly, Secure, SameSite=Lax, Path=/)
  ↓
Return 200 OK with sanitized User object
```

#### C. Session Validation Flow:
```text
Incoming HTTP Request / Server Component / Route Handler
  ↓
Extract 'salahtrack_session' from cookies (await cookies())
  ↓ (If cookie missing: return 401 Unauthorized / redirect to /login)
Query MongoDB Session collection by session token
  ↓
Check if session.expiresAt > Date.now()
  ↓ (If expired or missing: clear cookie, return 401 Unauthorized)
Optionally touch session: update session.lastActiveAt
  ↓
Populate User document (id, name, email, username, role)
  ↓
Proceed to handler with verified session context: { user, session }
```

#### D. Logout Flow:
```text
Browser Click "Logout"
  ↓ (HTTPS POST /api/auth/logout)
Extract 'salahtrack_session' from cookie
  ↓
Delete Session document from MongoDB Atlas (immediate server-side invalidation)
  ↓
Set-Cookie header with max-age=0 / expires in the past
  ↓
Return 200 OK -> Client redirects to /login
```

#### E. Password Reset Flow:
```text
1. User submits email on /forgot-password
   ↓
2. Query User by email. If found:
   - Generate secure random token (32 bytes hex)
   - Store SHA-256 hash of token in User.passwordResetTokenHash
   - Set User.passwordResetExpires = Date.now() + 15 * 60 * 1000 (15 minutes)
   - In dev: log reset link; in prod: send transactional email
   ↓
3. Return 200 OK with uniform message (prevents enumeration)
   ↓
4. User clicks link: /reset-password?token=<raw-token>
   ↓
5. Server hashes <raw-token> with SHA-256, queries User with valid expiration
   ↓
6. User provides new password -> Hash with Argon2id -> Update User.passwordHash
   ↓
7. Invalidate all active sessions for this userId in MongoDB (Security best practice)
   ↓
8. Clear passwordResetTokenHash and passwordResetExpires
```

### 4. Data Models (Mongoose Schemas)

#### User Model (`src/models/User.ts`):
```typescript
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  username: string;
  passwordHash: string;
  role: 'user' | 'admin';
  preferences: {
    language: 'uz' | 'ru' | 'en';
    calculationMethod?: string;
  };
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    preferences: {
      language: { type: String, enum: ['uz', 'ru', 'en'], default: 'uz' },
      calculationMethod: { type: String, default: 'MWL' },
    },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
```

#### Session Model (`src/models/Session.ts`):
```typescript
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISession extends Document {
  _id: mongoose.Types.ObjectId;
  sessionToken: string; // Cryptographically random token (or SHA-256 hash)
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    sessionToken: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: {
      type: Date,
      required: true,
      // MongoDB TTL Index: automatically removes expired session documents from Atlas!
      expires: 0,
    },
    userAgent: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Session: Model<ISession> =
  mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema);
```

### 5. API Contracts

| Endpoint | Method | Auth Required | Request Body / Query | Success Response | Error Responses |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/signup` | `POST` | No | `{ name, email, username, password, confirmPassword }` | `201 Created`<br>`{ success: true, data: { user } }`<br>*(Sets session cookie)* | `400 Bad Request` (Validation)<br>`409 Conflict` (Duplicate) |
| `/api/auth/login` | `POST` | No | `{ identifier, password, rememberMe? }` | `200 OK`<br>`{ success: true, data: { user } }`<br>*(Sets session cookie)* | `401 Unauthorized` (Generic)<br>`429 Too Many Requests` (Rate limit) |
| `/api/auth/logout` | `POST` | Yes | *None (reads session cookie)* | `200 OK`<br>`{ success: true, message: string }`<br>*(Clears session cookie)* | `200 OK` (Idempotent cleanup) |
| `/api/auth/me` | `GET` | Yes | *None (reads session cookie)* | `200 OK`<br>`{ success: true, data: { user } }` | `401 Unauthorized` |
| `/api/auth/forgot-password` | `POST` | No | `{ email }` | `200 OK`<br>`{ success: true, message: string }` | `429 Too Many Requests` |
| `/api/auth/reset-password` | `POST` | No | `{ token, newPassword, confirmPassword }` | `200 OK`<br>`{ success: true, message: string }` | `400 Bad Request` (Invalid/expired token) |

### 6. Security Requirements & Threat Mitigations
1. **Password Hashing:**
   - Primary: `argon2` (Argon2id variant, memory-hard, GPU/ASIC resistant). Minimum 19MB memory cost, 2 time iterations, parallelism 1.
   - Fallback: `bcryptjs` (work factor 12) if native environment compilation constraints demand it.
   - Plaintext passwords MUST NEVER be stored, displayed, or logged.
   - `passwordHash` marked with `select: false` on Mongoose schema to prevent accidental serialization.
2. **Session Cookie Hardening:**
   - Cookie Name: `salahtrack_session`
   - `HttpOnly: true` (strictly inaccessible to `document.cookie` / JavaScript).
   - `Secure: true` in production (enforced over TLS/HTTPS).
   - `SameSite: 'lax'` (prevents CSRF on cross-site requests while permitting top-level navigation).
   - `Path: '/'`
   - `Max-Age: 604800` (7 days standard) or `2592000` (30 days if rememberMe).
3. **Session Invalidation & Revocation:**
   - Logout immediately deletes the session document from MongoDB Atlas.
   - Changing or resetting a password immediately revokes all active sessions for that user.
   - MongoDB TTL index (`expires: 0` on `expiresAt`) ensures garbage collection of abandoned sessions without cron overhead.
4. **Brute-Force & Rate Limiting:**
   - Sliding-window rate limiter on `/api/auth/login` and `/api/auth/forgot-password`.
   - Tracked by Client IP + Identifier hash.
   - Maximum 5 failed attempts per 15-minute window; returns HTTP 429 with `Retry-After` header.
5. **Account Enumeration Defense:**
   - Login failures return a generic error: `"Invalid email/username or password"`.
   - Forgot password requests return the same success message whether the email exists or not.
   - Constant-time verification or dummy hashing on nonexistent users to eliminate timing side-channel attacks.
6. **Broken Object Level Authorization (BOLA / IDOR) Defense:**
   - Every protected API route (e.g. `/api/prayers/*`, `/api/accountability/*`) extracts `userId` from the verified session context.
   - Document lookups must always scope to the user: `await Prayer.findOne({ _id: id, userId: session.userId })`. Never trust client-supplied `userId` query/body parameters.

### 7. Agent Responsibility Matrix & File Allocation

| Agent Role | Direct File & Directory Ownership | Primary Deliverables |
| :--- | :--- | :--- |
| **TeamLead / Architect** | `AGENTS.md`, Architecture documentation, PR reviews, directory layout coordination | Milestone planning, boundary enforcement, schema approvals, review gates |
| **Security Agent** | `src/lib/auth/password.ts`<br>`src/lib/auth/session.ts`<br>`src/lib/auth/rate-limit.ts`<br>`src/lib/auth/validation.ts` | Argon2id hashing, secure session token generation, cookie configuration, rate limiter, OWASP audit |
| **Backend Agent** | `src/models/User.ts`<br>`src/models/Session.ts`<br>`src/app/api/auth/[signup\|login\|logout\|me\|forgot-password\|reset-password]/route.ts`<br>`src/lib/auth/guard.ts` | Mongoose models & indexes, Route Handlers, database operations, session lookup helper, BOLA guards |
| **Frontend Agent** | `src/app/(auth)/layout.tsx`<br>`src/app/(auth)/login/page.tsx`<br>`src/app/(auth)/signup/page.tsx`<br>`src/app/(auth)/forgot-password/page.tsx`<br>`src/app/(auth)/reset-password/page.tsx`<br>`src/locales/translations.ts` (auth keys)<br>`src/context/AuthContext.tsx` | Responsive auth layout (no app sidebar/nav), accessible auth forms, show/hide password, loading states, i18n |
| **QA / Performance** | `tests/auth/*.test.ts`<br>Postman / cURL test collections | Positive and negative test suites, rate-limit boundary testing, expired cookie checks, BOLA attempts |

### 8. Exact Next Task for the Security Agent
**Task:** Build the core cryptographic, hashing, and session validation utilities in `src/lib/auth/`:
1. Select and configure adaptive password hashing (`argon2` or `bcryptjs`) in `src/lib/auth/password.ts` with timing-safe comparisons.
2. Implement secure high-entropy session token generation (`crypto.randomBytes(32).toString('hex')`) and secure cookie options in `src/lib/auth/session.ts`.
3. Implement sliding-window rate limiting helper (`src/lib/auth/rate-limit.ts`) for authentication endpoints.
4. Define input validation rules for username, email, and password complexity in `src/lib/auth/validation.ts`.
*(Note: Do NOT build UI forms or connect Route Handlers until the Security Agent validates this foundation).*

---

## 11. Product Domain: SalahTrack Specification

SalahTrack is an original, calm, responsive, and professional prayer tracking and accountability web application. It is **not** a clone of existing commercial ad-heavy apps.

### Core Feature Modules:
1. **Dashboard (Home):**
   - Location-aware prayer times (via backend proxy route `src/app/api/prayer-times`).
   - Dynamic countdown to the next prayer.
   - Today's five prayers with distinct status badges.
   - Current consistency streak and active accountability summary.
   - Clean, uncluttered layout using semantic icons (e.g. Lucide), never raw emojis as production UI elements.

2. **Prayer Status Domain Model:**
   Every prayer state is explicitly tracked as an enum:
   - `PENDING` (Gray) — Prayer time not yet arrived or awaiting action.
   - `PRAYED_ON_TIME` (Green) — Performed within its prescribed window.
   - `PRAYED_LATE` (Yellow) — Performed after the window but before expiry.
   - `MISSED` (Red) — Unperformed past the required time.
   - `MADE_UP` (Blue) — Qaza fulfilled after being missed.

3. **Fine & Accountability System:**
   - **Important Disclaimer:** Explicitly framed as a personal discipline / accountability mechanism, **never** as a religious fatwa or ruling.
   - **Default Rules:**
     - Base missed-prayer fine: **15,000 UZS**
     - Make-up grace period: **7 days**
     - Additional overdue fine if not made up within 7 days: **+15,000 UZS** (Total 30,000 UZS)
   - **Configurability:** User-configurable amounts, deadlines, and toggleable state.
   - **Edge Cases to Handle:** Timezone shifts, retroactive corrections, makeup cancellations, duplicate records, integer currency storage (tiyin / whole UZS).

4. **History & Analytics:**
   - Interactive calendar and tabular day/week/month views.
   - Clearly defined statistical formulas:
     - On-time percentage: $(\text{Prayed on time} / \text{Total obligatory}) \times 100$
     - Current streak vs. Best streak calculation algorithms.

5. **Qibla Finder:**
   - Great-circle bearing calculation from user coordinates to Kaaba coordinates $(21.4225^\circ\text{ N}, 39.8262^\circ\text{ E})$.
   - Device orientation compass sensor integration with smooth interpolation.
   - **Strict Fallback:** When sensors or permissions are unavailable, display clear numeric bearing ($\text{XXX}^\circ$) without crashing or spinning aimlessly.

6. **Private Accountability Groups (Later Phase):**
   - Private group creation, invite codes, shared leaderboards/consistency metrics without breaching personal prayer privacy.

---

## 12. UI/UX & Responsive Design Rules

- **Design Philosophy:** Calm, modern, clean, professional, intuitive, accessible.
- **Anti-Patterns:** Avoid excessive gradients, distracting animations, oversized cards, and superficial fake AI gimmicks.
- **Mobile-First Ergonomics:**
  - Mobile (<768px): Sticky bottom navigation bar (`Home`, `History`, `Stats`, `Qibla`, `Profile`).
  - Tablet / Desktop (>=768px): Ergonomic collapsible sidebar or header navigation.
  - Test across 5 viewports: Small Mobile (360px), Standard Mobile (390px), Tablet (768px), Laptop (1024px), Desktop (1440px+).
- **Accessibility (a11y):** WCAG AA contrast ratios, full keyboard tab navigation, visible focus rings, ARIA labels for icon buttons, and semantic HTML (`<main>`, `<nav>`, `<header>`, `<article>`).

---

## 13. Security & OWASP Rigor

Security is a primary educational and architectural pillar of this project.

1. **Frontend vs. Backend Truth:**
   - Never trust frontend validation or hidden buttons.
   - Enforce all business rules, authentication, and authorization on Next.js API Route Handlers.
2. **Broken Object Level Authorization (BOLA / IDOR):**
   - A user querying `/api/prayers/[id]` must be verified as the owner of that document via JWT/session context (`{ _id: id, userId: session.userId }`), never via unverified user-supplied body parameters.
3. **NoSQL Injection & Sanitization:**
   - Prevent MongoDB operator injection (e.g. `{ "$gt": "" }`) by enforcing strict Mongoose schemas and validating input bodies using TypeScript / Zod schemas.
4. **Credential Security:**
   - Passwords hashed using `argon2` or `bcrypt` with strong work factors. No plaintext passwords ever stored or logged.
   - Authentication tokens stored in secure, `HttpOnly`, `SameSite=Strict`, `Secure` cookies.
5. **CORS & Security Headers:**
   - Strict CORS origins.
   - Helmet-style security headers configured via `next.config.ts` (CSP, HSTS, X-Frame-Options).
6. **Secrets Management:**
   - No credentials or API keys committed to Git. `.env.local` added to `.gitignore` with `.env.example` templates provided.

---

## 14. Error Handling & Professional Debugging Protocol

When encountering bugs or unexpected behavior, the agent will **never** indiscriminately wipe and rewrite files. Follow the professional diagnostic tree:

1. Inspect the exact error message and stack trace.
2. Check terminal server output and browser console logs.
3. Inspect network payloads (status code, request headers, request body, response).
4. Verify database state, MongoDB Atlas cluster connectivity, and Mongoose connection caching.
5. Inspect environment variable values and dependency lockfile versions.
6. Narrow down the root cause and explain the investigation steps before editing code.

---

## 15. AI Agent Behavior & Guardrails

1. **Incremental Execution:** Plan first, touch minimal files per step, and verify after every edit.
2. **Preserve Working Code:** Do not overwrite working components or erase existing styles without explanation.
3. **No Unexplained Packages:** Never run `npm install <package>` without explaining what the package does, why it is needed, and what lightweight alternatives exist.
4. **Learning vs. Production Distinction:** Explicitly label code when simplified for educational clarity versus how it would be architected in high-scale production.
5. **Active Checks:** Periodically prompt the developer to predict outputs, spot intentional bugs, and explain data flows to prevent passive AI dependence.

---

## 16. Interview Connection & Training Protocol

Every major milestone must conclude with an **INTERVIEW CONNECTION** section covering:
- **Foundational Concepts:** Event loops, promises, closures, NoSQL indexing, compound indexes in MongoDB, REST status codes, CSR vs SSR, hydration mismatch causes.
- **Scenario / Architecture Questions:**
  - *"Why is Mongoose connection caching necessary in Next.js App Router and serverless environments?"*
  - *"How does `useSyncExternalStore` prevent tearing and hydration mismatch when reading from `localStorage`?"*
  - *"How do you prevent race conditions when two client devices mark the same prayer made up simultaneously?"*
  - *"Why are `params` and `searchParams` asynchronous in Next.js 15+ and 16?"*
  - *"How would you explain the trade-offs of MongoDB document embedding vs referencing to a senior software architect?"*

---

## 17. 29-Phase Roadmap

- **Phase 0:** Computer & Linux Environment Setup
- **Phase 1:** Git & GitHub Foundations
- **Phase 2:** Project Architecture & Full-Stack Next.js Workspace Strategy
- **Phase 3:** Next.js + React + Tailwind Core Setup

- **Phase 4:** Design System & UI/UX Foundations

- **Phase 5:** Public Authentication UI
  - Login
  - Signup
  - Forgot Password UI
  - Responsive auth layout
  - Validation states
  - Loading/error/success states
  - Trilingual support

- **Phase 6:** Authentication Backend & Session Architecture
  - User schema
  - Password hashing
  - Login/signup endpoints or Server Functions
  - Session creation
  - Secure cookies
  - Logout

- **Phase 7:** Authorization & Protected Application Shell
  - Protected routes
  - User ownership checks
  - BOLA/IDOR prevention

- **Phase 8:** Next.js API Route Architecture
- **Phase 9:** MongoDB Atlas & Mongoose
- **Phase 10:** Client-Server Integration
- **Phase 11:** Core Prayer Tracking
- **Phase 12:** History
- **Phase 13:** Analytics
- **Phase 14:** Fine / Accountability Engine
- **Phase 15:** Prayer Times API
- **Phase 16:** Geolocation
- **Phase 17:** Qibla
- **Phase 18:** Private Groups
- **Phase 19:** Security Hardening
- **Phase 20:** Testing
- **Phase 21:** Docker
- **Phase 22:** GitHub Actions
- **Phase 23:** Deployment
- **Phase 24:** Monitoring
- **Phase 25:** Performance
- **Phase 26:** Accessibility
- **Phase 27:** Final Security Review
- **Phase 28:** Documentation & Portfolio
---

## 18. Quality Gates & Definition of Done

Before considering any phase or milestone complete, verify:
- [ ] **Functionality:** Feature executes cleanly without browser or server errors.
- [ ] **Responsiveness:** Validated on mobile (390px) and desktop (1280px+).
- [ ] **Internationalization:** All UI strings localized across `uz`, `ru`, and `en` via `src/locales/translations.ts`.
- [ ] **Security:** Authorization checks verified; no sensitive secrets (`MONGODB_URI`) leaked to the client bundle.
- [ ] **Offline Resilience:** Local actions update the UI optimistically with graceful background synchronization.
- [ ] **Error Handling:** Graceful UI fallbacks when network or MongoDB connectivity is interrupted.
- [ ] **Clean Code:** TypeScript types strictly declared (no loose `any`).
- [ ] **Explanation Delivered:** 10-point educational breakdown and interview coaching provided.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
