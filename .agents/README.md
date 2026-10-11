# SalahTrack Agent Architecture (Antigravity & Gemini)

Welcome to the **SalahTrack Custom Agent System** configured specifically for **Google Antigravity IDE and Gemini CLI (`agy`)**.

---

## 1. Directory Layout & Discovery

Antigravity natively scans the `.agents/` workspace root for project-specific configurations, skills, rules, and subagents. The agent registry is declared via `.agents/agents.json`:

```text
.agents/
├── agents.json                           # Manifest registering the custom agents directory
├── README.md                             # This guide and architecture documentation
└── agents/                               # Subagent definitions directory
    ├── pm-architect/
    │   └── agent.md                      # TeamLead, PM, and System Architect
    ├── frontend-specialist/
    │   └── agent.md                      # UI/UX, React 19, Tailwind v4, i18n
    ├── backend-specialist/
    │   └── agent.md                      # Route Handlers, MongoDB Atlas, Mongoose
    ├── security-devops/
    │   └── agent.md                      # Auth security, BOLA/IDOR, secrets, OWASP
    └── qa-performance/
        └── agent.md                      # Functional QA, a11y, hydration, builds
```

---

## 2. Agent Team Roster

| Agent Identifier | Mode | Role | Key File Allocations |
| :--- | :--- | :--- | :--- |
| **`pm-architect`** | `mainAgent`, `subagent` | Overall system architecture, milestone planning, data contracts, and quality enforcement. | `AGENTS.md`, Architecture docs, PR gates |
| **`frontend-specialist`** | `mainAgent`, `subagent` | UI development, component hierarchy, Tailwind CSS v4 styling, mobile responsiveness (320px–1440px+), and trilingual i18n. | `src/app/(auth)/*`, `src/components/*`, `src/locales/translations.ts` |
| **`backend-specialist`** | `mainAgent`, `subagent` | Serverless Next.js Route Handlers, Mongoose schemas & indexes, Zod validation, and database operations. | `src/models/*`, `src/app/api/*`, `src/lib/mongodb.ts` |
| **`security-devops`** | `mainAgent`, `subagent` | Authentication mechanics, Argon2id hashing, secure session cookies, rate limiting, BOLA/IDOR defense, and CI/CD. | `src/lib/auth/*`, tests/auth/*, `.env.example` |
| **`qa-performance`** | `mainAgent`, `subagent` | Functional testing, API contract verification, responsive/hydration checks, type safety, and production build audits. | `tests/**/*`, cURL test suites, build audits |

---

## 3. How Antigravity Discovers and Runs Agents

Each agent is defined using a canonical Markdown specification (`agent.md`) containing YAML frontmatter:

```yaml
---
name: pm-architect
description: Project Manager, Team Lead, and System Architect...
subagent: true
mainAgent: true
model: inherit
tools:
  - run_command
  - view_file
  - write_to_file
  - replace_file_content
  - ...
---
# AGENT ROLE: ...
System instructions and domain guidelines...
```

### Discovery Capabilities:
1. **Interactive Subagent Invocation:** The parent coordinator agent can invoke any specialized agent via the native `invoke_subagent` tool:
   ```json
   { "TypeName": "frontend-specialist", "Role": "UI Engineer", "Prompt": "Build the login form component" }
   ```
2. **Primary Agent Selection via CLI:** Start a session directly as a specialized agent:
   ```bash
   agy --agent backend-specialist
   ```
3. **Desktop IDE & CLI Picker:** Open the `/agents` panel in the Antigravity chat canvas or press `Alt+J` to view and monitor all registered agents.

---

## 4. The 10-Point Explanation Framework

Every agent operating in this repository is bound to the **10-Point Explanation Framework** defined in [AGENTS.md](file:///home/az11k/Projects/salahtrack/AGENTS.md) Section 3. Whenever a meaningful change is completed, the agent generates a structured walkthrough ensuring deep developer understanding and technical interview readiness.
