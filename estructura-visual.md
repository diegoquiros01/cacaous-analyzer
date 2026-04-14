# Estructura Visual — DocsValidate

## Resumen del Producto

DocsValidate es un validador de documentos de exportación impulsado por IA, especializado en embarques de cacao y café. Analiza múltiples tipos de documentos (Bill of Lading, Facturas Comerciales, Packing Lists, Certificados Fitosanitarios, etc.) y detecta inconsistencias entre ellos antes del despacho aduanero.

---

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3 — sin frameworks
- **Backend:** Netlify Functions (serverless)
- **IA:** Anthropic Claude (Sonnet + Haiku)
- **Auth:** Clerk
- **Pagos:** Stripe
- **Base de datos:** Supabase PostgreSQL
- **Librerías:** PDF.js, XLSX, Mammoth (Word), html2pdf, EmailJS
- **Deploy:** Netlify

---

## Tipografía

| Fuente           | Pesos              | Uso                          |
| ---------------- | ------------------ | ---------------------------- |
| Playfair Display | 400, 500, italic   | Títulos, headings, display   |
| Lato             | 300, 400, 700      | Texto body, botones          |
| Raleway          | 300, 400, 500, 600 | Labels, texto pequeño, UI    |

---

## Paleta de Colores (CSS Variables)

### Colores Base

| Variable          | Valor     | Uso                            |
| ----------------- | --------- | ------------------------------ |
| `--white`         | `#ffffff` | Fondo de cards, header         |
| `--offwhite`      | `#f7f8fa` | Fondo de botones inactivos     |
| `--cream`         | `#f0f2f5` | Fondo alternativo, summary     |
| `--cream2`        | `#e4e8ee` | Fondo secundario               |
| `--brown-dark`    | `#0f1117` | Textos principales, botones CTA |
| `--brown`         | `#1c2230` | Textos secundarios fuertes     |
| `--brown-mid`     | `#3a4660` | Textos medios, progress bar    |
| `--brown-light`   | `#6b7a99` | Labels, placeholder            |
| `--tan`           | `#4a6fa5` | Accent primario (azul-gris)    |
| `--tan-light`     | `#7da4d4` | Accent claro, hover            |

### Colores Semánticos

| Variable          | Valor     | Uso                            |
| ----------------- | --------- | ------------------------------ |
| `--green`         | `#1a6b3a` | Éxito, aprobado                |
| `--green-light`   | `#2e9455` | Badge aprobado                 |
| `--red`           | `#7a2e22` | Error, rechazado               |
| `--red-light`     | `#b04030` | Badge error                    |
| `--text`          | `#0f1117` | Texto principal                |
| `--text-mid`      | `#3a4255` | Texto secundario               |
| `--text-light`    | `#7a8499` | Texto terciario, muted         |
| `--border`        | `#d0d6e2` | Bordes principales             |
| `--border-light`  | `#e8edf5` | Bordes sutiles, separadores    |

---

## Z-Index Stack

| Nivel  | Elemento           |
| ------ | ------------------ |
| 2000+  | Modales            |
| 200    | Header             |
| 100    | Progress bar       |
| 90     | Upload stepper     |
| 0      | Contenido          |

---

## Páginas

### 1. INDEX.HTML — Aplicación Principal

#### A. HEADER (fixed, height: 68px)

```
┌───────────────────────────────────────────────────────────────────┐
│ [Logo] DOCSVALIDATE    Home | Pricing | Contact   [ES|EN] [User] │
│         tagline (Raleway 0.52rem)                                │
└───────────────────────────────────────────────────────────────────┘
```

- **Posición:** fixed, z-index 200
- **Fondo:** var(--white)
- **Borde inferior:** 1px solid var(--border-light)
- **Logo:** imagen + wordmark "DOCSVALIDATE"
- **Nav:** 0.65rem uppercase, letter-spacing 0.2em
- **Idioma:** botones ES | EN con underline en activo
- **User badge:** dinámico — "Sign in" o menú (Reports, Account, Sign out)

---

#### B. HERO (min-height: 440px, imagen de fondo)

```
┌───────────────────────────────────────────────────────────────────┐
│                    (background: hero-1.jpg)                       │
│              overlay: gradient rgba(5,8,18,0.65→0.40)            │
│                                                                   │
│            ┌─────────────────────────────────┐                    │
│            │  EYEBROW PILL (blur backdrop)   │                    │
│            │  0.7rem uppercase, #a8c8f0      │                    │
│            └─────────────────────────────────┘                    │
│                                                                   │
│       Título Principal H1 (Playfair 2.2-3.2rem clamp)           │
│       Con <em> en itálica color #a8c8f0                          │
│                                                                   │
│            ┌─────────────────────────────────┐                    │
│            │  SUBTITLE PILL (blur backdrop)  │                    │
│            │  0.92rem, rgba(255,255,255,0.96)│                    │
│            └─────────────────────────────────┘                    │
│                                                                   │
│  [Analiza docs] [Extrae datos] [Detecta inconsistencias] [...]  │
│  (badges 0.72rem, blur backdrop, rgba borders)                   │
└───────────────────────────────────────────────────────────────────┘
```

---

#### C. PROGRESS BAR (sticky, top: 68px)

```
┌───────────────────────────────────────────────────────────────────┐
│  (1) SELECT TYPES  │  (2) UPLOAD FILES  │  (3) ANALYZE  │  (4) DOWNLOAD │
│  bg: var(--brown-dark), white text                                │
│  Paso activo: color var(--tan-light), número bg var(--tan)       │
│  Paso completado: color rgba(255,255,255,0.55)                   │
│  Paso pendiente: color rgba(255,255,255,0.35)                    │
└───────────────────────────────────────────────────────────────────┘
```

---

#### D. SECCIÓN: Selección de Tipos de Documento

```
┌───────────────────────────────────────────────────────────────────┐
│  max-width: 1040px, centered                                     │
│                                                                   │
│  Título sección + descripción                                    │
│                                                                   │
│  GRID: 5 columnas (→ 3 @900px → 2 @600px)                       │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │ [BL]   │ │ [INV]  │ │ [PL]   │ │ [PHYTO]│ │ [COI]  │        │
│  │ Bill of│ │Commerce│ │Packing │ │Phytosan│ │Origin  │        │
│  │ Lading │ │Invoice │ │ List   │ │ Cert   │ │ Cert   │        │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │ [FUMI] │ │ [QC]   │ │[PERMIT]│ │ [ISF]  │ │ [NOTIF]│        │
│  │Fumigat.│ │Quality │ │Import  │ │  ISF   │ │Shipping│        │
│  │  Cert  │ │  Cert  │ │ Permit │ │        │ │ Notif  │        │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │
│  ┌────────┐ ┌────────┐ ┌────────┐                                │
│  │ [DECL] │ │ [ORG]  │ │ Other  │                                │
│  │Declarat│ │Organic │ │ Custom │                                │
│  └────────┘ └────────┘ └────────┘                                │
│                                                                   │
│  Botón normal: bg offwhite, border 1px var(--border), 0.58rem    │
│  Botón activo: bg brown-dark, color white, border brown-dark     │
│  Botón hover: border-color tan, color brown                      │
└───────────────────────────────────────────────────────────────────┘
```

---

#### E. SECCIÓN: Upload Panel

```
┌───────────────────────────────────────────────────────────────────┐
│  STEPPER (sticky top 68px)                                        │
│  ○───○───○  (círculos con líneas, check verde al completar)      │
│                                                                   │
│  CHIPS resumen de tipos seleccionados:                            │
│  [BL] [Invoice] [Packing List] [+ Edit]                         │
│  (dark bg, white text, 0.6rem, border-radius 20px)               │
│                                                                   │
│  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐ │
│  │           UPLOAD AREA (dashed border)                        │ │
│  │                                                              │ │
│  │     Drag files or select (Playfair 1.1rem)                  │ │
│  │     XLSX, PDF, Word, JPG (0.72rem, text-light)              │ │
│  │     [BROWSE FILES] (brown-dark bg, white, 0.65rem)          │ │
│  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘ │
│                                                                   │
│  FILES LIST:                                                      │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ [PDF] invoice-cacaous.pdf    2.3 MB   ✓ Detected: INV [X]│    │
│  │ [XLS] packing-list.xlsx      450 KB   ✓ Detected: PL  [X]│    │
│  │ [IMG] bl-scan.jpg            1.1 MB   ✓ Detected: BL  [X]│    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │  ░░░░░░░░░░░░░░░░░  ANALYZE  ░░░░░░░░░░░░░░░░░░░░░░░░░  │    │
│  │  (full width, animated gradient brown→tan, pulse + shimmer)│   │
│  │  0.75rem uppercase, letter-spacing 0.28em, bold            │   │
│  └───────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

---

#### F. SECCIÓN: Loading / Progreso

```
┌───────────────────────────────────────────────────────────────────┐
│  max-width: 640px, centered                                       │
│                                                                   │
│             ┌──────────────┐                                      │
│             │  ╭─ring─╮    │  Anillos giratorios (tan + brown)   │
│             │  │ bean  │   │  Icono cacao central con "breathe"  │
│             │  ╰───────╯   │                                      │
│             └──────────────┘                                      │
│                                                                   │
│  "EXTRACTING DOCUMENTS"  0.65rem uppercase                        │
│  72%  (Playfair 1.5rem)                                           │
│                                                                   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  (6px height, gradient fill)         │
│                                                                   │
│  ● Analyzing Commercial Invoice...  (0.7rem, dot pulse tan)      │
│                                                                   │
│  ⏳ bill-of-lading.pdf          Pending                           │
│  🔄 commercial-invoice.pdf      Extracting...                     │
│  ✓  packing-list.xlsx           Done                              │
└───────────────────────────────────────────────────────────────────┘
```

---

#### G. SECCIÓN: Resultados

##### G1. Verdict Banner

```
┌───────────────────────────────────────────────────────────────────┐
│ ║                                                                 │
│ ║  ┌────┐                                                         │
│ ║  │ ✓  │  Set approved — coherence verified                     │
│ ║  │72px│  "All documents are consistent..."  (0.82rem)          │
│ ║  └────┘                                                         │
│ ║                                                                 │
│  (borde izquierdo 6px sólido, coloreado según estado)            │
│  Aprobado: verde   |  Observaciones: tan   |  Rechazado: rojo   │
└───────────────────────────────────────────────────────────────────┘
```

##### G2. Stats Row (4 columnas)

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│     5        │      3       │      1       │      1       │
│  Documents   │    OK ✓      │  Warnings ⚠  │  Errors ✗    │
│  (tan)       │  (green)     │  (tan)       │  (red)       │
│  Playfair 3rem números, 0.58rem labels uppercase           │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

##### G3. Header de Resultados (Transporte + Comercial)

```
┌───────────────────────────────────────────────────────────────────┐
│  COMMERCIAL                          TRANSPORT                    │
│  Total: $150,480.00 USD              B/L: MSCUAB123456           │
│  Price: $3,200/MT                    Vessel: MSC FANTASIA        │
│  [FOB] [T/T 30 days]                Voyage: FA435E               │
│                                      Guayaquil → New York        │
└───────────────────────────────────────────────────────────────────┘
```

##### G4. Tabla de Coherencia

```
┌───────────────────────────────────────────────────────────────────┐
│  COHERENCE ANALYSIS  (header dark: brown-dark, white, Playfair)  │
├───────────────────────────────────────────────────────────────────┤
│  Field          │ Status    │ Values                              │
│─────────────────┼───────────┼─────────────────────────────────────│
│  B/L Number     │ [OK ✓]    │ MSCUAB123456 (all docs)            │  ← bg verde claro
│  Containers     │ [ERROR ✗] │ BL: MSCU1234 / PL: MSCU5678       │  ← bg rojo claro
│  Net Weight     │ [OK ✓]    │ 18,000 KG (all docs)               │  ← bg verde claro
│  Destination    │ [SINGLE]  │ United States (1 doc only)         │  ← bg normal
└───────────────────────────────────────────────────────────────────┘
```

##### G5. Cards de Inconsistencias

```
Error card:
┌───────────────────────────────────────────────────────────────────┐
│  ✗ Container Numbers                               [CRITICAL]    │
│  bg: rgba(122,46,34,0.05), border: #7a2e22                      │
├───────────────────────────────────────────────────────────────────┤
│  "BL shows MSCU1234567 but Packing List shows MSCU9876543.      │
│   This could indicate cargo was loaded in wrong container."      │
│                                                                   │
│  • Bill of Lading:  MSCU1234567                                  │
│  • Packing List:    MSCU9876543                                  │
└───────────────────────────────────────────────────────────────────┘

Warning card:
┌───────────────────────────────────────────────────────────────────┐
│  ⚠ Net Weight                                       [WARNING]    │
│  bg: rgba(74,111,165,0.07), border: #4a6fa5                     │
├───────────────────────────────────────────────────────────────────┤
│  "Minor difference of 20 KG between documents..."                │
└───────────────────────────────────────────────────────────────────┘
```

##### G6. Cards Por Documento (acordeón expandible)

```
┌───────────────────────────────────────────────────────────────────┐
│ ║ Bill of Lading                                            [▼]  │
│ ║ bl-scan.pdf                          [APPROVED ✓]              │
│ ║ (stripe 4px izquierda: verde=ok, tan=warn, rojo=error)        │
├───────────────────────────────────────────────────────────────────┤
│  (EXPANDIDO — grid auto-fill minmax(190px, 1fr))                 │
│                                                                   │
│  B/L Number        Shipper           Consignee                   │
│  MSCUAB123456      Cacaous S.A.      US Imports LLC              │
│                                                                   │
│  Vessel            Port Load         Port Discharge              │
│  MSC FANTASIA      Guayaquil         New York                    │
│                                                                   │
│  Containers        Net Weight        Gross Weight                │
│  MSCU1234567       18,000 KG         18,500 KG                   │
│                                      ▲ rojo si inconsistente     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ "Document is consistent with the rest of the set."          │ │
│  │  (Playfair italic, tan left border 3px)                     │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

##### G7. AI Summary

```
┌───────────────────────────────────────────────────────────────────┐
│  ═══ (tan top border 3px)                                        │
│  bg: var(--cream)                                                │
│                                                                   │
│  COHERENCE ANALYST  (0.58rem uppercase, tan)                     │
│                                                                   │
│  "The document set for shipment MSCUAB123456 aboard MSC          │
│   FANTASIA shows overall consistency across 5 documents.         │
│   Container numbers and seal numbers match across all docs.      │
│   One observation: net weight shows minor variance of 20 KG      │
│   between the Commercial Invoice and Packing List."              │
│                                                                   │
│  (Playfair Display 1rem italic, text-mid, line-height 1.9)      │
└───────────────────────────────────────────────────────────────────┘
```

##### G8. Action Items

```
┌───────────────────────────────────────────────────────────────────┐
│  ACTION ITEMS  (0.62rem uppercase, red)                          │
│                                                                   │
│  1. Request corrected Packing List from Cacaous S.A.             │
│  2. Confirm destination country with shipper                     │
│  3. Verify seal numbers before container release                 │
│                                                                   │
│  (numbered, 0.78rem, red number + text-mid content)              │
└───────────────────────────────────────────────────────────────────┘
```

##### G9. Action Buttons

```
┌───────────────────────────────────────────────────────────────────┐
│  border-top: 1px solid                                           │
│                                                                   │
│  [DOWNLOAD PDF REPORT]  [VERIFY CARRIER]  [ANALYZE ANOTHER SET] │
│   brown-dark bg           optional          white bg, border     │
└───────────────────────────────────────────────────────────────────┘
```

---

### 2. PRICING.HTML — Precios

```
┌───────────────────────────────────────────────────────────────────┐
│  HEADER (misma navegación)                                       │
├───────────────────────────────────────────────────────────────────┤
│  HERO                                                             │
│  Título + Descripción                                            │
├───────────────────────────────────────────────────────────────────┤
│  BILLING TOGGLE                                                   │
│  [Monthly ○──● Annual]  "Save 20%" badge                         │
├───────────────────────────────────────────────────────────────────┤
│  PLAN CARDS (grid 3 columnas, gap 1.5rem)                        │
│                                                                   │
│  ┌──────────────┐  ┌══════════════════┐  ┌──────────────┐       │
│  │   STARTER    │  ║  PROFESSIONAL    ║  │  ENTERPRISE  │       │
│  │              │  ║  (FEATURED)      ║  │              │       │
│  │    Free      │  ║   $119/mo        ║  │   $189/mo    │       │
│  │              │  ║  border 2px tan  ║  │              │       │
│  │  5 valid/mo  │  ║  100 valid/mo    ║  │  Unlimited   │       │
│  │  ✓ feature   │  ║  ✓ feature       ║  │  ✓ feature   │       │
│  │  ✓ feature   │  ║  ✓ feature       ║  │  ✓ feature   │       │
│  │  — excluded  │  ║  ✓ feature       ║  │  ✓ feature   │       │
│  │              │  ║                  ║  │              │       │
│  │  [Contact]   │  ║  [Subscribe]     ║  │  [Subscribe] │       │
│  └──────────────┘  ╚══════════════════╝  └──────────────┘       │
│                                                                   │
│  Featured card: bg brown-dark, white text, 2px tan border        │
├───────────────────────────────────────────────────────────────────┤
│  COMPARISON TABLE                                                 │
│  Feature          │ Starter │ Professional │ Enterprise          │
│  ─────────────────┼─────────┼──────────────┼──────────           │
│  Validations/mo   │    5    │     100      │  Unlimited          │
│  PDF Reports      │    ✓    │      ✓       │     ✓               │
│  ...              │         │              │                      │
├───────────────────────────────────────────────────────────────────┤
│  FAQs (acordeón colapsable)                                      │
│  ▶ Pregunta 1                                                    │
│  ▶ Pregunta 2                                                    │
│  ▼ Pregunta 3 (expandida)                                        │
│    Respuesta visible aquí...                                     │
└───────────────────────────────────────────────────────────────────┘
```

---

### 3. CONTACT.HTML — Contacto

```
┌───────────────────────────────────────────────────────────────────┐
│  HEADER                                                          │
├───────────────────────────────────────────────────────────────────┤
│  HERO: "How can we help you?"                                    │
├───────────────────────────────────────────────────────────────────┤
│  TWO COLUMNS                                                     │
│                                                                   │
│  LEFT: Tipo de contacto          RIGHT: Formulario dinámico      │
│  ┌─────────────────────┐         ┌─────────────────────────┐     │
│  │ 💬 General inquiry  │         │ Name    [____________]  │     │
│  │ 🚀 Free trial       │         │ Email   [____________]  │     │
│  │ 🛠 Support [green]  │         │ Company [____________]  │     │
│  │ 📋 Request demo     │         │ Message [____________]  │     │
│  │                     │         │         [____________]  │     │
│  │ Info cards:         │         │ Priority [Select ▼]     │     │
│  │ Response time       │         │ Attach   [Choose file]  │     │
│  │ Priority level      │         │                         │     │
│  └─────────────────────┘         │ [SEND MESSAGE]          │     │
│                                  └─────────────────────────┘     │
│                                                                   │
│  Success state: ✓ "We'll be in touch" + ticket reference         │
└───────────────────────────────────────────────────────────────────┘
```

---

### 4. TERMS.HTML — Términos

```
┌───────────────────────────────────────────────────────────────────┐
│  HEADER                                                          │
├───────────────────────────────────────────────────────────────────┤
│  DARK HERO (brown-dark bg, white text)                           │
│  H1: Terms of Service (Playfair)                                 │
├───────────────────────────────────────────────────────────────────┤
│  TABLE OF CONTENTS                                               │
│  (bordered box, teal left border, numbered anchor links)         │
├───────────────────────────────────────────────────────────────────┤
│  CONTENT (max-width: 800px)                                      │
│  Sections with markdown-style headings                           │
│  Critical boxes: tan left border, light blue bg                  │
└───────────────────────────────────────────────────────────────────┘
```

---

### 5. ADMIN.HTML — Panel Admin

```
┌─────────┬─────────────────────────────────────────────────────────┐
│ SIDEBAR │  MAIN CONTENT                                          │
│ 200px   │                                                         │
│ sticky  │  Page Header (Playfair 1.6rem) + subtitle              │
│         │                                                         │
│ Overview│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  Dashbrd│  │ Users   │ │ Valids  │ │ Errors  │ │ Revenue │     │
│ Data    │  │   142   │ │  1,230  │ │    15   │ │  $2.4k  │     │
│  Users  │  │ (tan)   │ │ (green) │ │ (red)   │ │(yellow) │     │
│  Valids │  └─────────┘ └─────────┘ └─────────┘ └─────────┘     │
│  Errors │                                                         │
│ Payments│  TABLES: Users, Validations, Payments                  │
│  Stripe │  (sortable, filterable, with status badges)            │
│ Analytic│                                                         │
│         │  CHARTS: Bar chart validaciones/día                    │
│         │                                                         │
│ Active: │  BADGES:                                                │
│ tan left│  Plan: Starter(cream) | Pro(blue) | Enterprise(green)  │
│ border  │  Status: Active(green) | Trial(yellow) | Canceled(red) │
│ 2px,    │  Error: Critical(red) | Warning(yellow) | Info(blue)   │
│ cream bg│                                                         │
└─────────┴─────────────────────────────────────────────────────────┘
```

---

### 6. TEST.HTML — Suite de Tests

```
┌───────────────────────────────────────────────────────────────────┐
│  [Logo] Extraction Test Suite          [RUN ALL TESTS]           │
├───────────────────────────────────────────────────────────────────┤
│  Summary: [12 PASS] [2 FAIL]                                    │
├───────────────────────────────────────────────────────────────────┤
│  Test Card: Bill of Lading                          [PASS ✓]    │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Field        │ Expected       │ Actual         │ Match    │   │
│  │ B/L Number   │ MSCUAB123      │ MSCUAB123      │ OK ✓    │   │
│  │ Vessel       │ MSC FANTASIA   │ MSC FANTASIA   │ OK ✓    │   │
│  └───────────────────────────────────────────────────────────┘   │
├───────────────────────────────────────────────────────────────────┤
│  Test Card: Commercial Invoice                      [FAIL ✗]    │
│  ...                                                             │
└───────────────────────────────────────────────────────────────────┘
```

---

## Componentes Reutilizables

### Header (compartido en todas las páginas)

```css
position: fixed;
top: 0;
width: 100%;
height: 68px;
z-index: 200;
background: var(--white);
border-bottom: 1px solid var(--border-light);
display: flex;
align-items: center;
padding: 0 2rem;
```

### Card genérica

```css
background: var(--white);
border: 1px solid var(--border-light);
border-radius: 10px;
padding: 1.5rem;
```

### Botón Primario (CTA)

```css
background: var(--brown-dark);
color: white;
border: none;
border-radius: 6px;
padding: 0.8rem 1.5rem;
font-family: 'Raleway', sans-serif;
font-size: 0.65rem;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.2em;
cursor: pointer;
```

### Botón Secundario

```css
background: var(--white);
color: var(--brown-dark);
border: 1px solid var(--border);
border-radius: 6px;
padding: 0.8rem 1.5rem;
font-size: 0.65rem;
text-transform: uppercase;
letter-spacing: 0.2em;
```

### Botón Analyze (animado)

```css
width: 100%;
padding: 1.2rem;
font-size: 0.75rem;
font-weight: bold;
text-transform: uppercase;
letter-spacing: 0.28em;
background: linear-gradient(135deg, var(--brown-mid), var(--tan));
color: white;
border-radius: 8px;
/* Animaciones: btn-pulse, btn-shimmer, btn-bounce */
```

### Status Badge

```css
font-size: 0.58rem;
padding: 0.2rem 0.6rem;
border-radius: 20px;
text-transform: uppercase;
letter-spacing: 0.15em;
font-weight: 600;
/* Colores según estado: green/tan/red + bg semitransparente */
```

### Document Type Button

```css
/* Normal */
background: var(--offwhite);
border: 1px solid var(--border);
color: var(--text-mid);
font-size: 0.58rem;
text-transform: uppercase;
border-radius: 6px;
padding: 0.8rem;
display: flex;
flex-direction: column;
align-items: center;
gap: 0.3rem;

/* Activo */
background: var(--brown-dark);
border-color: var(--brown-dark);
color: white;
```

### Upload Area

```css
border: 2px dashed var(--border);
border-radius: 12px;
padding: 3rem 2rem;
text-align: center;
/* Drag-over state: border-color var(--tan), background cream */
```

### Modal

```css
/* Overlay */
position: fixed;
inset: 0;
background: rgba(0, 0, 0, 0.5);
z-index: 2000;
display: flex;
align-items: center;
justify-content: center;

/* Container */
background: var(--white);
border-radius: 12px;
padding: 2rem;
max-width: 500px;
width: 90%;
max-height: 80vh;
overflow-y: auto;
```

### Inconsistency Card

```css
/* Error */
background: rgba(122, 46, 34, 0.05);
border: 1px solid rgba(122, 46, 34, 0.15);
border-left: 4px solid #7a2e22;
border-radius: 8px;
padding: 1.2rem;

/* Warning */
background: rgba(74, 111, 165, 0.07);
border: 1px solid rgba(74, 111, 165, 0.15);
border-left: 4px solid #4a6fa5;

/* Info */
background: rgba(100, 120, 180, 0.07);
border: 1px solid rgba(100, 120, 180, 0.15);
border-left: 4px solid #6478b4;
```

---

## Animaciones

| Nombre      | Duración | Tipo              | Uso                     |
| ----------- | -------- | ----------------- | ----------------------- |
| btn-pulse   | 2s       | ease-in-out ∞     | Shadow grow/shrink      |
| btn-shimmer | 3s       | linear ∞          | Gradient shift          |
| btn-bounce  | 1.5s     | ease-in-out ∞     | Y-translate             |
| spin-ring   | 1.2/1.8s | linear ∞          | Loader rings (opuestos) |
| breathe     | 2s       | ease-in-out ∞     | Loader bean scale       |
| dot-pulse   | 1.2s     | ease-in-out ∞     | Status dot              |
| spin        | 0.8s     | linear ∞          | Spinners genéricos      |

---

## Responsive Breakpoints

| Ancho   | Cambio                                        |
| ------- | --------------------------------------------- |
| ≥1040px | Layout completo, grid 5 columnas              |
| ≤900px  | Grid tipos de documento → 3 columnas          |
| ≤600px  | Grid tipos de documento → 2 columnas          |
| General | Sticky header (68px) + sticky progress bar    |

---

## Modales del Sistema

1. **Auth Modal** — Requiere aceptar términos antes de signup
2. **Upgrade Modal** — Aparece al alcanzar límite del plan
3. **Profile Modal** — Detalles de cuenta (email, plan, uso, fecha reset)
4. **Checkout Success** — Confirmación de pago exitoso con checkmark

---

## Assets

| Archivo      | Tamaño | Uso                              |
| ------------ | ------ | -------------------------------- |
| `hero-1.jpg` | 116 KB | Background hero principal        |
| `hero-2.jpg` | 102 KB | Background hero alternativo      |
| `logo.png`   | 30 KB  | Logo (invertido para fondos dark)|

---

## Idiomas

- **Español (ES)** y **Inglés (EN)** completos
- Toggle en header
- Traducciones almacenadas en objeto `tx()` en app.js
- AI Summary se traduce dinámicamente con Claude

---

## Integraciones Backend

| Servicio | Uso                                         |
| -------- | ------------------------------------------- |
| Claude   | Extracción de documentos + análisis coherencia |
| Clerk    | Autenticación de usuarios                   |
| Stripe   | Pagos y suscripciones                       |
| Supabase | Base de datos + storage                     |
| EmailJS  | Envío de formulario de contacto             |
| Netlify  | Hosting + serverless functions              |

---

## Notas para Rediseño

- Todo el CSS es **inline en los HTML** — no hay archivos CSS separados (solo variables en `<style>` tags)
- No usa ningún framework CSS (Tailwind, Bootstrap, etc.)
- La app es **vanilla JS** — no React, no componentes, todo en DOM directo
- El progress bar de 4 pasos es el **flujo principal** de la app
- Los resultados son la sección más compleja visualmente (verdict → stats → tabla → cards → summary → actions)
- El admin es una **página separada** con layout sidebar + contenido
- Hay **dark mode parcial** — solo en el hero y progress bar (no en toda la app)
- Pricing tiene la card del medio "featured" con fondo oscuro
- El loader de cacao con anillos giratorios es un elemento visual distintivo de la marca
