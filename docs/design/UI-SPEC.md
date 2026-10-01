# User Interface Specification - Artupski ReSite

Technical specification for desktop UI screens, component structures, design tokens, theme system, state management, and accessibility standards.

---

## 1. Mandatory Frontend Engineering Skill Directive

> [!CRITICAL]
> **MANDATORY INSTRUCTION FOR ALL FRONTEND DEVELOPERS AND CODING AGENTS**:
> Before writing, modifying, or reviewing any frontend component, style, or UI implementation code for Artupski ReSite, you **MUST** read and strictly follow the design principles and finish gates specified in:
> `C:\Users\Kakarama Room\.agents\skills\anti-ui-slop\SKILL.md`
>
> Generic AI dashboard tropes (gratuitous neon glows, floating cards with identical rounded borders, meaningless metric sparklines, purple-on-black hero buttons, low-contrast text) are strictly forbidden. All interfaces must follow purposeful, high-density, utility-driven desktop software ergonomics.

---

## 2. Screen Specifications

Artupski ReSite comprises 9 primary functional screen states and workflows managed inside Tauri 2.

```
+-------------------------------------------------------------------------+
| [Initial Screen]                                                        |
|   ├── Input Target URL & Scan Configuration                             |
|   └── Recent Projects & Cached Blueprint Library                        |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| [Scanning Screen]                                                       |
|   ├── Multi-stage Phase Stepper & Real-time Console                     |
|   └── [Auth Interaction Modal] (Conditional if protected routes detected)
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| [Scan Results Screen]                                                   |
|   ├── Overview Tab           ├── Technologies Screen                    |
|   ├── Pages Tab              ├── Responsive Preview Screen              |
|   ├── Components Tab         ├── Visual Comparison Screen               |
|   └── Assets / Logs / Blueprint Tab                                     |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| [Tech Stack Selection Screen]                                           |
|   └── Algorithmic Target Scoring (Next.js / Laravel / Custom)           |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| [Project Documentation & Export Screen]                                 |
|   ├── Static Clone Packager (ZIP / Offline Explorer)                   |
|   └── Full Project Code Synthesizer & Markdown Doc Exporter             |
+-------------------------------------------------------------------------+
```

---

### 2.1 Initial Screen

Entry surface when launching desktop application.

- **Primary Action Zone**:
  - Target URL Input Box: Wide monospace input with automatic protocol prepending (`https://`), clipboard paste listener, and immediate host validation.
  - Project Title & Target Directory selector with native file dialog button (`tauri/dialog`).
- **Scan Configuration Accordion**:
  - Max Crawl Depth: Numeric stepper (`1` to `5`, default: `2`).
  - Max Pages: Numeric input (default: `25`).
  - Headless Toggle: Boolean switch.
  - Viewports: Checkbox group (Desktop `1440x900`, Tablet `768x1024`, Mobile `375x667`).
  - Auth Mode: Radios (`None`, `Manual Browser Login`, `Pre-authenticated Cookies`).
- **Recent Projects List**:
  - Table showing Project Name, Target Domain, Date Created, Page Count, Status Badge (`Draft`, `Scanned`, `Generated`), and direct Open button.

---

### 2.2 Scanning Screen

Active execution monitor displayed during live Playwright reverse-engineering.

- **Multi-stage Phase Stepper**:
  1. Engine Initialization & Browser Launch.
  2. Network & Sitemap Discovery.
  3. Dynamic DOM & Route Crawler.
  4. Asset Downloading & CSS Extraction.
  5. Technology Signature Matching.
  6. AI Blueprint Synthesis.
- **Metrics Bar**:
  - Active Elapsed Time counter (`HH:MM:SS`).
  - Pages Crawled count (`N / Total Discovered`).
  - Assets Ingested (count and total downloaded megabytes).
  - Current Worker State (`idle`, `navigating`, `extracting`, `waiting`).
- **Live Activity Console**:
  - Virtualized monospace terminal component (`react-virtualized` or `@tanstack/react-virtual`).
  - Emits real-time event bus logs with timestamp, log level (`INFO`, `WARN`, `DEBUG`, `ERROR`), and active URL.
  - Controls: "Pause Crawl", "Skip Active Page", "Abort & Preserve Partial Results".

---

### 2.3 Auth Interaction Modal

Modal displayed when scanner encounters login forms, HTTP 401/403, or protected redirect targets.

- **Header**: "Manual Authentication Required".
- **Instructional Body**: Informs user that Playwright has launched an interactive browser window to allow manual 2FA, OAuth, or credentials entry.
- **Controls**:
  - "Launch Controlled Browser Window": Calls Tauri native backend to open headful browser at target login route.
  - "Session Capture Indicator": Real-time status indicator showing detected cookie storage and local storage changes.
  - "Confirm Login Complete & Continue": Verifies presence of auth cookies (`HttpOnly`) and resumes crawling.
  - "Skip Authentication": Proceeds crawling public routes only.

---

### 2.4 Scan Results Screen

Comprehensive tabbed dashboard organizing blueprint analysis.

- **Global Actions**: "Open Static Clone", "Export Blueprint JSON", "Select Target Tech Stack".
- **Tab Navigation**:
  - **Overview**: High-level site summary, detected CMS/framework, estimated component count, overall crawl health.
  - **Technologies**: Detailed tech breakdown (see 2.5).
  - **Pages**: Hierarchical tree view of discovered URLs, status codes, canonical links, layout mappings.
  - **Components**: Grouped list of detected UI components (Header, Nav, Hero, Cards, Tables, Footers) with live code previews and DOM element counts.
  - **Responsive**: Multi-viewport viewer (see 2.6).
  - **Assets**: Gallery view of downloaded images, SVGs, stylesheets, scripts with filter by MIME type and size.
  - **Authentication**: Summary of captured auth headers, token patterns, and protected endpoint map.
  - **Blueprint**: Raw interactive JSON viewer with syntax highlighting and instant JSON schema validator badge.
  - **Logs**: Historical log playback with error filter.

---

### 2.5 Technologies Screen

Specialized technology inventory inspired by diagnostic toolsets (Wappalyzer / BuiltWith).

- **Category Cards Grouping**:
  - Web Frameworks & Libraries (e.g., React, Next.js, Vue).
  - UI Component Systems (e.g., Tailwind CSS, Radix UI, Bootstrap).
  - Analytics & Trackers (e.g., Google Analytics 4, Segment, Hotjar).
  - Backend & Server Technologies (e.g., Nginx, Express, Cloudflare, PHP).
  - Authentication Providers (e.g., Clerk, Supabase Auth, Auth0).
- **Per-Technology Badge Card Attributes**:
  - Icon / Tech Glyph.
  - Verified Version string (e.g., `v14.2.3`).
  - Confidence Score Meter (`0% - 100%`).
  - Detection Evidence Trigger List: Monospace badges showing specific DOM selector, Script URL, or HTTP response header match.

---

### 2.6 Responsive Preview Screen

Side-by-side or tabbed multi-device viewport inspection.

- **Device Switcher**: Desktop (`1440px`), Tablet (`768px`), Mobile (`375px`), or Freeform Drag Handle.
- **Sandboxed IFrame Preview**: Local HTTP proxy serving static clone assets inside isolated frame.
- **Inferred Breakpoint Inspector**:
  - Side panel listing detected CSS media query rules extracted from stylesheets (`@media (min-width: 640px)`, `@media (max-width: 1024px)`).
  - Interactive rule highlighter: clicking a breakpoint rule snaps the viewport width to that exact threshold.

---

### 2.7 Visual Comparison Screen

Pixel-accurate verification tool comparing original live target with reverse-engineered clone.

- **Comparison Modes**:
  1. **Side-by-Side**: Two synchronized scrolling viewports (Live Website vs Local Clone).
  2. **Slider Overlay**: Interactive horizontal split slider revealing live original on left, clone on right.
  3. **Pixel Diff (Image Processing)**: Highlights rendering discrepancies in red/magenta overlay using client-side canvas subtraction.
- **Discrepancy Inspector**: Displays percentage visual match score and lists missing fonts, layout shifts, or missing image assets.

---

### 2.8 Tech Stack Selection Screen

Decision matrix for transforming Blueprint into full project source code.

- **Algorithmic Ranking Matrix**:
  - Top recommendation scored automatically based on detected original site libraries (e.g., if site used React + Tailwind, Next.js scores `98% Match`).
- **Supported Output Targets**:
  - **Next.js (App Router)**: TypeScript, Tailwind CSS, Lucide Icons, Zod.
  - **Laravel**: Livewire / Blade, Tailwind CSS, Alpine.js, SQLite/MySQL.
  - **Custom Stack Template**: Configurable framework templates.
- **Feature Configuration Flags**:
  - State Management: (`Zustand`, `React Query`, `Native State`).
  - Auth Stubbing: (`Mock JWT Session`, `Clerk Starter`, `NextAuth`).
  - Database Models: (`Prisma ORM`, `Drizzle ORM`, `Eloquent`).

---

### 2.9 Project Documentation & Export Screen

Final artifact packaging and source file export.

- **Documentation Previewer**:
  - Interactive viewer for generated documentation markdown files:
    - [`PRD.md`](../product/PRD.md:1)
    - [`PLAN.md`](../product/PLAN.md:1)
    - [`ARCHITECTURE.md`](../architecture/ARCHITECTURE.md:1)
    - [`DATABASE.md`](../architecture/DATABASE.md:1)
    - `UI-SPEC.md`
    - `ADMIN-SPEC.md`
    - `API-SPEC.md`
    - `FEATURES.md`
    - `AGENTS.md`
    - `TODO.md`
    - `CHANGELOG.md`
- **Export Action Triggers**:
  - "Open Output Directory in File Manager" (Tauri shell open).
  - "Bundle Project as ZIP Archive".
  - "Launch Static Preview Server" (Starts local dev server on `http://localhost:3000`).

---

## 3. Design System & Layout Tokens

Artupski ReSite utilizes a strict, functional design system built on high-density utility principles.

### 3.1 Color Palette & Tokens

| Token Name | Light Theme Value | Dark Theme Value (Default) | Role |
| :--- | :--- | :--- | :--- |
| `--bg-base` | `#ffffff` | `#0f1117` | Window root canvas |
| `--bg-surface` | `#f8fafc` | `#161922` | Cards, panels, modals |
| `--bg-surface-elevated` | `#ffffff` | `#1e2230` | Dropdowns, popovers, tooltips |
| `--border-subtle` | `#e2e8f0` | `#262c3d` | Dividers, panel borders |
| `--border-focus` | `#2563eb` | `#38bdf8` | Focused inputs, active selections |
| `--text-primary` | `#0f172a` | `#f1f5f9` | Primary headings, active values |
| `--text-secondary` | `#475569` | `#94a3b8` | Metadata labels, descriptions |
| `--text-muted` | `#94a3b8` | `#64748b` | Disabled states, timestamps |
| `--accent-brand` | `#2563eb` | `#0284c7` | Brand CTAs, primary execution buttons |
| `--accent-success` | `#16a34a` | `#22c55e` | Scan completed, verified badge |
| `--accent-warning` | `#d97706` | `#f59e0b` | Auth required, missing assets |
| `--accent-danger` | `#dc2626` | `#ef4444` | Crawl errors, validation failure |

### 3.2 Typography

- **UI Sans**: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `Roboto`, `sans-serif`.
- **Code & Logs Monospace**: `"JetBrains Mono"`, `"Fira Code"`, `Consolas`, `monospace`.
- **Scale**:
  - Display: `20px` / `line-height: 28px` / Font-weight: `600`
  - Heading: `16px` / `line-height: 24px` / Font-weight: `600`
  - Body: `13px` / `line-height: 20px` / Font-weight: `400`
  - Caption / Meta: `11px` / `line-height: 16px` / Font-weight: `500`
  - Code: `12px` / `line-height: 18px` / Font-weight: `400`

---

## 4. State Management Architecture (Zustand)

Global UI and scan session state is partitioned into decoupled Zustand stores.

```typescript
import { create } from 'zustand';

export interface ScanStoreState {
  targetUrl: string;
  projectId: string | null;
  status: 'idle' | 'configuring' | 'scanning' | 'auth_required' | 'completed' | 'failed';
  activePhase: string;
  progressPercent: number;
  logs: Array<{ id: string; timestamp: string; level: 'info' | 'warn' | 'error'; message: string }>;
  discoveredPages: string[];
  setTargetUrl: (url: string) => void;
  setStatus: (status: ScanStoreState['status']) => void;
  appendLog: (level: 'info' | 'warn' | 'error', message: string) => void;
  resetScan: () => void;
}

export const useScanStore = create<ScanStoreState>((set) => ({
  targetUrl: '',
  projectId: null,
  status: 'idle',
  activePhase: '',
  progressPercent: 0,
  logs: [],
  discoveredPages: [],
  setTargetUrl: (url) => set({ targetUrl: url }),
  setStatus: (status) => set({ status }),
  appendLog: (level, message) =>
    set((state) => ({
      logs: [
        ...state.logs.slice(-1000), // Retain sliding window of 1000 logs
        { id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, message }
      ]
    })),
  resetScan: () =>
    set({
      status: 'idle',
      activePhase: '',
      progressPercent: 0,
      logs: [],
      discoveredPages: []
    })
}));
```

---

## 5. Accessibility & Ergonomics Standards

1. **Full Keyboard Operability**:
   - Every action, modal, and tab must support `Tab`, `Shift+Tab`, `Enter`, `Escape`, and arrow key navigation.
   - Quick shortcuts: `Ctrl+K` / `Cmd+K` launches command palette; `Ctrl+R` starts scan; `Escape` closes active modal.
2. **Contrast & Sizing Compliance**:
   - Minimum text contrast ratio of 4.5:1 for standard body copy and 3:1 for large display headers against background surfaces.
   - Interactive button touch/click targets maintain a minimum dimension of `32px` height inside dense desktop viewports.
3. **Screen Reader Support**:
   - Aria live regions (`aria-live="polite"`) configured for scanner activity logs and progress bar percent changes.

---

## 6. Phase 1 Implementation Notes

The Phase 1 shell implements a subset of this specification and resolves a few ambiguities:

1. **Theme default**: Section 3.1 marks Dark as default; the implementation defaults to `dark` and persists the choice under the `resite.settings` localStorage key (Zustand `persist`), including a `system` option.
2. **Tokens**: Section 3.1 hex values are encoded as RGB channel CSS variables in `src/styles/tokens.css` and consumed via Tailwind utilities (`bg-base`, `text-text-primary`, `border-border-subtle`, etc.). Components must not hardcode colors.
3. **Scan lifecycle**: Section 4's `scanStore` shape is implemented. Phase 1 rendered configuration controls only with the scan action disabled. **Phase 4 (workstream 3) wires it to the real crawler**: the store lifecycle is `idle | configuring | scanning | completed | failed | cancelled` (mirroring the crawl outcome), the Start button runs a real crawl, progress comes from the crawl's own events (never fabricated), and `auth_required` is deferred to the authentication phase. See section 7.
4. **Fonts**: `Inter` and `JetBrains Mono` are declared in the Tailwind font stack but are not bundled; the system fallbacks render until self-hosted fonts are introduced in a later phase.

---

## 7. Phase 4 Scan Screen (as built)

The Scan route (`src/routes/ScanRoute.tsx`) implements the configuration + execution subset of section 2.1/2.2 and is wired to the real crawler through `src/services/scanner/scanService.ts`.

- **Target**: URL entry with validation; the owning project is auto-selected from the typed URL or can be created inline ("Create project for this URL"). Start is enabled only when the URL is valid, a project is resolved, and no crawl is running.
- **Configuration**: Max crawl depth (1-5) and Max pages (1-200) map to the crawler's clamped limits; the Run-headless toggle is honored. **Viewports are shown disabled and labelled `Deferred`** because multi-viewport capture is not part of Phase 4 (responsive analysis is a later phase) - they do not affect the crawl.
- **States**: honest `Idle | Ready | Scanning | Completed | Failed | Cancelled`; a `role="alert"` error surface shows the message and suggested action (never a raw stack trace).
- **Progress & console**: a real progress bar (`aria-valuenow`) plus scanned/discovered counts from the frontier, a bounded live activity log (`aria-live="polite"`), and a discovered-pages list. Nothing is simulated.
- **Keyboard & focus**: deliberate focus movement - to **Cancel scan** when a crawl starts, and to the result/progress region when it settles. All controls are keyboard-operable with visible labels.
- **Deferred**: authentication modal (section 2.3), the multi-stage stepper, screenshots/assets, and technology/responsive tabs remain later phases and are not shown.
