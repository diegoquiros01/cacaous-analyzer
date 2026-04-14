# DocsValidate — Estado Actual del Proyecto

## Qué es DocsValidate
Validador de documentos de exportación impulsado por IA, especializado en embarques de cacao y café. Analiza múltiples documentos (Bill of Lading, Facturas, Packing Lists, Certificados Fitosanitarios, COI, etc.) y detecta inconsistencias entre ellos antes del despacho aduanero.

---

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (sin frameworks)
- **Backend:** Netlify Functions (serverless Node.js)
- **IA:** Anthropic Claude (Sonnet para análisis pesado, Haiku para extracción ligera)
- **Auth:** Clerk (JWT)
- **Pagos:** Stripe (suscripciones)
- **DB:** Supabase PostgreSQL + Storage
- **Librerías client:** PDF.js, XLSX, Mammoth (Word), html2pdf, EmailJS
- **Deploy:** Netlify
- **Idiomas:** Español + Inglés (toggle completo)

---

## Arquitectura de Archivos

### Páginas (todas vanilla HTML con CSS inline en `<style>`)

| Archivo | Líneas | Función |
|---------|--------|---------|
| `index.html` | 914 | **Marketing homepage** — hero, demo card, how it works, features, docs supported, social proof, CTA, footer. NO contiene la app. |
| `app.html` | 2043 | **App completa** — nav minimal, progress bar 4 pasos, upload panel, loading/análisis, resultados, modales auth/upgrade. |
| `pricing.html` | 495 | Planes: Starter (gratis), Professional ($119/mo), Enterprise ($189/mo). Stripe checkout. |
| `contact.html` | 643 | Formulario de contacto con EmailJS. 4 tipos: general, trial, soporte, demo. |
| `terms.html` | 500 | Términos de servicio. |
| `admin.html` | 587 | Panel admin (sidebar + contenido). Users, validaciones, Stripe, analytics. |

### JavaScript Frontend (`js/`)

| Archivo | Función |
|---------|---------|
| `app.js` (~1300 líneas) | Lógica principal: idioma, upload de archivos, drag & drop, flujo de análisis, reset, UI updates |
| `extraction.js` (~520 líneas) | Detección de tipo de documento por filename, extracción de campos con Claude, split de PDFs multi-página, limpieza de campos, validación de containers/seals |
| `coherence.js` (~1090 líneas) | Análisis de coherencia: pre-checks determinísticos (BL es master para containers, seals, vessel, ports), normalización de valores (pesos, puertos, países, empresas), llamada a Claude para análisis cruzado, filtrado de diferencias triviales |
| `auth.js` (~280 líneas) | Integración con Clerk: login, signup, user badge, modales auth/upgrade, guest counting |
| `rendering.js` (~1250 líneas) | Renderizado de resultados: verdict banner, stats, tabla de coherencia, cards de inconsistencias, cards por documento, summary AI |
| `pdf.js` (~300 líneas) | Generación de reporte PDF con html2pdf + reporte texto plano |
| `history.js` (~270 líneas) | Guardar/cargar/eliminar reportes en Supabase |

### Netlify Functions (`netlify/functions/`)

| Archivo | Función |
|---------|---------|
| `claude.js` | Proxy a Anthropic API. Valida origen, JWT Clerk o guest token. Timeout 55s. Modelos permitidos: Haiku 4.5, Sonnet 4. |
| `user.js` | Gestión de usuarios: plan, validaciones usadas, límites, reset mensual. Planes: starter(10), professional(100), enterprise(300). |
| `rate-limit.js` | Rate limiting por IP para guests: 3 análisis/día. Usa Netlify Blobs. |
| `create-checkout.js` | Crea sesión de Stripe Checkout para suscripciones. |
| `stripe-webhook.js` | Webhook de Stripe: actualiza plan en Supabase tras pago. HMAC-SHA256 verification. |
| `history.js` | CRUD de reportes guardados en Supabase (validation_history). |
| `admin.js` | Backend del admin: overview, users, pagos, errores, analytics. |
| `verify-jwt.js` | Helper para verificar JWT de Clerk (JWKS). |

### Config

| Archivo | Función |
|---------|---------|
| `netlify.toml` | Headers de cache, seguridad, redirects (/app→app.html, /pricing→pricing.html, /contact→contact.html) |
| `package.json` | Solo `@netlify/blobs` como dependencia |

### Assets

| Archivo | Uso |
|---------|-----|
| `hero-1.jpg` (116KB) | Background del hero en index.html |
| `hero-2.jpg` (102KB) | Background alternativo |
| `logo.png` (30KB) | Logo de DocsValidate |

---

## Sistema de Diseño

### Paleta de Colores (CSS Variables)

```css
:root {
  /* Base */
  --white: #ffffff;
  --offwhite: #f7f8fa;
  --cream: #f0f2f5;
  --cream2: #e4e8ee;
  
  /* Legacy (usados en app) */
  --brown-dark: #0f1117;
  --brown: #1c2230;
  --brown-mid: #3a4660;
  --brown-light: #6b7a99;
  --tan: #4a6fa5;
  --tan-light: #7da4d4;
  
  /* New aliases (mismo valor, nombre más claro) */
  --navy: #0d1b2a;      /* Primario oscuro — nav, headers, buttons */
  --ink: #1c2230;        /* Texto heavy */
  --mid: #3a4660;        /* Texto medio */
  --muted: #6b7a99;      /* Texto secundario */
  --steel: #4a6fa5;      /* Accent azul — links, warning states */
  --sky: #7da4d4;        /* Accent claro */
  --mint: #3ecfaa;       /* Accent verde — CTAs, approved, active states */
  --mint-dark: #28a989;  /* Mint oscuro para texto sobre fondo claro */
  
  /* Semánticos */
  --green: #1a6b3a;      /* Success (usado en coherence OK) */
  --green-light: #2e9455;
  --red: #7a2e22;        /* Error, rejected */
  --red-light: #b04030;
  
  /* Utilidad */
  --text: #0f1117;
  --text-mid: #3a4255;
  --text-light: #7a8499;
  --border: #d0d6e2;
  --border-light: #e8edf5;
  --shadow: 0 4px 24px rgba(13,27,42,.10);
  --shadow-lg: 0 16px 48px rgba(13,27,42,.18);
}
```

### Tipografía

| Fuente | Pesos | Uso |
|--------|-------|-----|
| **Playfair Display** | 400, 500, 700, italic 400, 500 | Títulos, headings, display, números grandes |
| **Raleway** | 300, 400, 500, 600, 700 | Labels, botones, nav, small text, UI |
| **Lato** | 300, 400, 700 | Body text, párrafos |

### Componentes Visuales Clave

**Marketing (index.html):**
- Nav: fixed, 68px, backdrop-filter blur, shadow on scroll
- Hero: min-height 92vh, background image + gradient overlay (navy 75%→95%), frosted CTAs
- Botones: `.btn-mint` (CTA principal), `.btn-primary` (navy), `.btn-ghost` (outline)
- Demo card: mock de análisis con window chrome (dots red/yellow/green)
- Sections: 90px padding, `.reveal` con IntersectionObserver
- Footer: navy background, links + lang switch

**App (app.html):**
- Nav: fixed, 68px, minimal (logo + user badge + lang)
- Progress bar: sticky top:68px, navy, paso activo en mint
- Upload stepper: done=mint, active=navy
- Upload panel: border-radius 14px, shadow sutil
- Drop zone: dashed border, radius 12px, hover=steel
- Chips: navy background, mint dot, pill shape (100px radius)
- Analyze button: mint gradient con pulse animation cuando ready
- Loading: cacao bean loader con rings giratorios
- Verdict: approved=mint, warning=steel, rejected=red
- Coherence table: navy header
- Per-document cards: acordeón expandible con stripe lateral coloreada
- Modals: border-radius 14px

---

## Flujo de Navegación

```
docsvalidate.com (index.html — marketing)
  ├── "Start free" → /app
  ├── "Analyze Documents for Free" → /app
  ├── "Pricing" → /pricing
  ├── "Contact" → /contact
  ├── "Sign in" → /app
  └── Footer: Pricing, Contact, Terms, Instagram, TikTok

/app (app.html — la aplicación)
  ├── Logo → / (home)
  ├── Step 1: Seleccionar tipos de documento (grid de botones)
  ├── Step 2: Upload (drag & drop, file list, auto-detect tipo)
  ├── Step 3: Análisis con Claude (loading + progress por archivo)
  ├── Step 4: Resultados (verdict, stats, tabla, cards, AI summary, PDF)
  └── Auth modal (Clerk) si no está logueado

/pricing (pricing.html)
  ├── Toggle mensual/anual
  ├── 3 cards: Starter, Professional ($119), Enterprise ($189)
  ├── Tabla comparativa
  ├── FAQs
  └── CTA → /app

/contact (contact.html)
  ├── 4 tipos de contacto
  ├── Formulario dinámico
  └── EmailJS envío

/admin (admin.html) — solo admins
  ├── Overview, Users, Validations, Errors
  ├── Stripe payments
  └── Analytics
```

---

## Flujo de Análisis (app.html)

```
1. Usuario selecciona tipos de documento (BL, Invoice, PL, Phyto, COI, etc.)
2. Sube archivos (PDF, Excel, Word, imágenes) — drag & drop o browse
3. Auto-detección: filename → tipo de documento (regex en extraction.js)
4. PDFs multi-página: Haiku clasifica páginas y detecta boundaries
5. Clic "Analyze":
   a. Por cada archivo → extractDoc() → Claude extrae campos estructurados
   b. analyzeCoherence() → pre-checks JS determinísticos + Claude Sonnet
   c. filterTrivialInconsistencies() → limpia falsos positivos
6. Renderizado: verdict, stats, coherence table, inconsistency cards, per-doc detail
7. Opciones: Download PDF, Save Report, Track Shipment, New Analysis
```

---

## Base de Datos (Supabase)

```sql
users (clerk_id, email, plan, validations_used, stripe_customer_id, last_reset)
validation_history (id, clerk_id, bl_number, vessel_name, status, doc_count, error_count, warning_count, summary_text, result_json)
webhook_events (event_id, created_at) -- deduplicación de Stripe webhooks
```

---

## Planes y Precios

| Plan | Precio | Validaciones/mes | Billing anual |
|------|--------|-----------------|---------------|
| Starter | Gratis | 10 | — |
| Professional | $119/mo | 100 | $95/mo (20% off) |
| Enterprise | $189/mo | 300 | $151/mo (20% off) |

Guest (sin login): 3 análisis/día por IP.

---

## Notas Importantes

1. **No hay frameworks** — todo es vanilla HTML/CSS/JS
2. **Cada página tiene su propio CSS inline** en `<style>` — no hay archivo CSS compartido
3. **Las variables CSS se repiten** en cada archivo (index, app, pricing, contact, terms, admin)
4. **El BL es siempre el documento master** — containers, seals, vessel, ports del BL nunca se cuestionan
5. **Haiku se usa para docs pequeños (<500KB)**, Sonnet para PDFs grandes y coherencia
6. **El sistema de traducción** está en el `<script>` global de app.html (objeto TX con EN/ES completo)
7. **Clerk maneja auth** — JWT verificado server-side en las Netlify Functions
8. **Los modales (auth, upgrade)** solo existen en app.html, no en index.html
