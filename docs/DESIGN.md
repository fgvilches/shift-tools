# shift-tools — Documento de Diseño y Plan de Implementación

> Una navaja suiza para macOS. Backend en Rust, frontend en Tauri 2. Herramientas de desarrollo, redes, seguridad y testing, organizadas por categorías, con una interfaz rápida, accesible y de una sola ventana.

**Versión:** 1.0  
**Fecha:** 2025-01-15  
**Plataforma objetivo:** macOS 13+ (Apple Silicon y Intel)  
**Stack:** Rust (backend) + Tauri 2 (frontend) + TypeScript + React/Vue (a definir, recomendado: React 18 + Vite)

---

## Tabla de Contenidos

1. [Visión y Principios](#1-visión-y-principios)
2. [Arquitectura General](#2-arquitectura-general)
3. [Categorías y Herramientas](#3-categorías-y-herramientas)
4. [Diseño de UI/UX](#4-diseño-de-uiux)
5. [Especificación Técnica por Herramienta](#5-especificación-técnica-por-herramienta)
6. [Modelo de Datos y Persistencia](#6-modelo-de-datos-y-persistencia)
7. [Plan de Implementación](#7-plan-de-implementación)
8. [Estructura del Repositorio](#8-estructura-del-repositorio)
9. [Prompt para el Agente de UI](#9-prompt-para-el-agente-de-ui)

---

## 1. Visión y Principios

**shift-tools** es una aplicación de escritorio macOS que agrupa utilidades frecuentes para desarrolladores, ingenieros de redes y testers. No es un IDE, no es un launcher, no es un monitor genérico. Es una caja de herramientas con una sola ventana, categorías claras, y ejecución inmediata.

### Principios de diseño

| Principio | Aplicación |
|-----------|------------|
| **Cero fricción** | Un clic para ejecutar. Sin diálogos modales innecesarios. Las acciones destructivas piden confirmación, pero no interrumpen el flujo. |
| **Categorías, no caos** | Las tools se agrupan por dominio: DevOps, Redes, Seguridad, Testing, Sistema. El usuario no busca, navega. |
| **Rust por debajo** | Todo el trabajo pesado (procesos, red, archivos, escaneo) vive en Rust. El frontend es una capa delgada de presentación. |
| **Nativo pero no caro** | Tauri 2 con WebView nativo de macOS. Sin Electron. Sin bundling de Chromium. |
| **Accesible por defecto** | ARIA labels, focus visible, navegación por teclado, contraste suficiente. |
| **Offline first** | Ninguna funcionalidad core depende de conectividad externa. Las tools de red funcionan en LAN sin internet. |

---

## 2. Arquitectura General

### 2.1 Diagrama de alto nivel

```
┌─────────────────────────────────────────┐
│           Tauri 2 Frontend              │
│  (React/Vue + TypeScript + Tailwind)   │
│  - Sidebar de categorías                │
│  - Panel de tool activa                 │
│  - Componentes reutilizables            │
└─────────────────┬───────────────────────┘
                  │ IPC (commands, events)
                  ▼
┌─────────────────────────────────────────┐
│           Tauri 2 Core                  │
│  - Window management                    │
│  - File system access                   │
│  - Shell execution (limited)            │
│  - Event bus (frontend ↔ backend)       │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│           Rust Backend                  │
│  - Process management (sysinfo)         │
│  - Network scanning (pnet, dns)         │
│  - File operations (xattr, codesign)    │
│  - WiFi signal (CoreWLAN via objc)      │
│  - BLE scanning (CoreBluetooth)         │
│  - SQLite persistence (sqlx)            │
│  - Export engines (JSON, CSV, PDF)      │
└─────────────────────────────────────────┘
```

### 2.2 Comunicación Frontend ↔ Backend

- **Commands**: Llamadas síncronas para acciones puntuales (ej. `kill_processes`, `clear_quarantine`).
- **Events**: Streams para datos continuos (ej. `network_scan_progress`, `wifi_signal_update`).
- **State**: Tauri state para configuración global y datos de sesión.

### 2.3 Dependencias clave de Rust

```toml
[dependencies]
tauri = { version = "2", features = ["shell-open", "dialog-all", "fs-all"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
sysinfo = "0.30"           # Procesos y RAM
pnet = "0.34"              # Packet capture y scanning
trust-dns-resolver = "0.23" # DNS queries
sqlx = { version = "0.7", features = ["runtime-tokio", "sqlite"] } # Persistencia
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
anyhow = "1"
thiserror = "1"
log = "0.4"
env_logger = "0.11"
objc = "0.2"               # Para CoreWLAN y CoreBluetooth
core-foundation = "0.9"
cocoa = "0.25"             # macOS bindings
```

---

## 3. Categorías y Herramientas

### 3.1 DevOps & Sistema

| Tool | Descripción | Prioridad |
|------|-------------|-----------|
| **Process Killer** | Mata procesos de desarrollo residual (Python, Node, Rust, Java, Kotlin, Swift, Tauri, Electron, etc.) para liberar RAM. | P0 |
| **Quarantine Remover** | Arrastra un `.app` y ejecuta `xattr -d com.apple.quarantine` + `xattr -cr`. | P0 |
| **Port Manager** | Lista puertos en uso, mata procesos por puerto, muestra quién escucha dónde. | P1 |
| **Disk Cleaner** | Limpia caches de Xcode, DerivedData, npm, pip, cargo, docker. | P2 |
| **RAM Monitor** | Vista rápida de consumo por proceso, con opción de matar desde ahí. | P1 |

### 3.2 Redes

| Tool | Descripción | Prioridad |
|------|-------------|-----------|
| **Network Observer** | Basado en Fieldwatch: escaneo pasivo de WiFi APs y BLE devices, con fingerprints y reportes. | P0 |
| **WiFi Mapper** | Mapeo de señal WiFi por ubicación física, con canvas para dibujar el espacio y registrar RSSI por punto. | P0 |
| **LAN Scanner** | Escaneo de red local: hosts, puertos abiertos, servicios, MAC vendor. | P1 |
| **DNS Toolkit** | Consultas DNS (A, AAAA, MX, TXT, CNAME), propagación, comparación de resolvers. | P1 |
| **Speed Test** | Test de velocidad local (iperf3 integrado o descarga HTTP). | P2 |
| **Ping / Traceroute** | Visualización de latencia y ruta, con gráficos en tiempo real. | P2 |

### 3.3 Seguridad & Pentest

| Tool | Descripción | Prioridad |
|------|-------------|-----------|
| **Header Analyzer** | Analiza headers HTTP de una URL: seguridad, CORS, CSP, cookies. | P1 |
| **SSL Inspector** | Verifica certificado SSL/TLS: expiración, cadena, cipher suites, vulnerabilidades comunes. | P1 |
| **Subdomain Finder** | Enumera subdominios via DNS brute-force y crt.sh. | P2 |
| **Hash Generator** | Genera y verifica hashes (MD5, SHA1, SHA256, SHA512, bcrypt). | P2 |
| **Password Auditor** | Genera contraseñas seguras, verifica fuerza, check contra haveibeenpwned (offline k-anonymity). | P2 |

### 3.4 Testing & APIs

| Tool | Descripción | Prioridad |
|------|-------------|-----------|
| **API Tester** | Cliente HTTP ligero (GET, POST, PUT, DELETE, headers, body, auth). Historial de requests. | P0 |
| **JSON Toolkit** | Formatear, validar, minificar, convertir JSON ↔ YAML ↔ CSV. Diff de JSONs. | P0 |
| **Base64 / URL Encoder** | Codifica/decodifica Base64, URL encoding, HTML entities, JWT decode. | P1 |
| **Regex Tester** | Editor de regex con highlighting en tiempo real y explicación de grupos. | P1 |
| **Cron Validator** | Valida y explica expresiones cron, muestra próximas ejecuciones. | P2 |
| **UUID Generator** | Genera UUIDs v4, ULIDs, nanoids. | P2 |

### 3.5 Utilidades Generales

| Tool | Descripción | Prioridad |
|------|-------------|-----------|
| **Color Picker** | Pick color from screen, convertir entre HEX, RGB, HSL, OKLCH. | P2 |
| **Text Diff** | Compara dos textos con diff visual. | P2 |
| **Markdown Preview** | Renderiza Markdown en tiempo real. | P2 |
| **Timestamp Converter** | Unix ↔ ISO ↔ humano, con timezone support. | P1 |

---

## 4. Diseño de UI/UX

### 4.1 Layout general

```
┌─────────────────────────────────────────────────────────────┐
│  macOS Titlebar (traffic lights integrados)                 │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│  SIDEBAR │           MAIN CONTENT AREA                      │
│  (240px) │                                                  │
│          │  ┌──────────────────────────────────────────┐    │
│  🔧 Dev  │  │  Tool Header                             │    │
│  🌐 Net  │  │  - Título, descripción, acciones         │    │
│  🔒 Sec  │  ├──────────────────────────────────────────┤    │
│  🧪 Test │  │                                          │    │
│  🛠️ Util │  │  Tool Content                            │    │
│          │  │  - Formularios, botones, resultados      │    │
│  ─────── │  │  - Logs, tablas, gráficos                │    │
│  ⚙️ Set  │  │                                          │    │
│          │  └──────────────────────────────────────────┘    │
│          │                                                  │
│  [Tool]  │  Status bar: memoria, procesos, red             │
│  [Tool]  │                                                  │
│  [Tool]  │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

### 4.2 Sistema de diseño

- **Tema**: Dark mode por defecto, light mode opcional. Liquid glass effects en sidebar y cards (translucidez, blur, bordes sutiles).
- **Tipografía**: SF Pro (sistema), con fallback a Inter. Monospace: SF Mono / JetBrains Mono.
- **Colores**:
  - Background: `#0a0a0f` (dark), `#f5f5f7` (light)
  - Accent: `#0a84ff` (azul macOS)
  - Success: `#30d158`
  - Warning: `#ffd60a`
  - Error: `#ff453a`
  - Surface (glass): `rgba(255,255,255,0.08)` con `backdrop-filter: blur(20px)`
- **Espaciado**: Sistema de 4px base (4, 8, 12, 16, 24, 32, 48).
- **Bordes**: Radius 8px en cards, 6px en botones, 12px en modales.
- **Iconos**: SF Symbols vía CSS o SVG inline. No usar emojis como iconos.

### 4.3 Componentes reutilizables

| Componente | Props | Uso |
|------------|-------|-----|
| `ToolCard` | `title`, `description`, `icon`, `category`, `onClick` | Grid de tools en home |
| `DataTable` | `columns`, `rows`, `sortable`, `filterable`, `actions` | Resultados de scans, procesos |
| `LogViewer` | `logs`, `autoScroll`, `levelFilter` | Output de comandos |
| `ProgressBar` | `value`, `max`, `indeterminate` | Scans, exports |
| `ConfirmDialog` | `title`, `message`, `destructive`, `onConfirm` | Acciones destructivas |
| `EmptyState` | `icon`, `title`, `description`, `action` | Estados vacíos |
| `StatusBadge` | `status`, `label` | Indicadores de estado |
| `CopyButton` | `text`, `format` | Copiar al clipboard |
| `ExportMenu` | `formats`, `onExport` | Exportar resultados |

### 4.4 Accesibilidad

- Todos los botones e inputs tienen `aria-label` o texto visible.
- Focus visible con outline de 2px en accent color.
- Navegación por teclado: `Tab` entre elementos, `Enter` para activar, `Escape` para cerrar modales.
- Contraste mínimo 4.5:1 para texto normal, 3:1 para texto grande.
- `role="log"` en LogViewer, `role="status"` en StatusBadge.

---

## 5. Especificación Técnica por Herramienta

### 5.1 Process Killer (DevOps)

**Objetivo**: Liberar RAM matando procesos de desarrollo residual.

**Procesos objetivo**:
- Interpretados: `python`, `python3`, `node`, `deno`, `bun`, `ruby`
- Compiladores: `cargo`, `rustc`, `swiftc`, `javac`, `kotlinc`, `go`, `clang`
- Build tools: `tauri`, `electron-builder`, `webpack`, `vite`, `rollup`, `gradle`, `maven`
- IDEs y helpers: `code`, `idea`, `studio`, `emulator`, `simulator`
- Servidores: `nginx`, `apache`, `postgres`, `redis`, `mysql`, `docker` (containers)
- Otros: `adb`, `fastboot`, `xcodebuild`, `simctl`

**Comportamiento**:
1. Lista procesos que coinciden con patrones (nombre, comando, path).
2. Muestra: nombre, PID, RAM, CPU, tiempo activo, comando completo.
3. Permite seleccionar individualmente o "matar todos".
4. Usa `SIGTERM` primero, `SIGKILL` si no responde en 3s.
5. Excluye procesos del sistema críticos (PID < 100, launchd, WindowServer, etc.).
6. Excluye procesos de apps en ejecución visibles (si el usuario tiene VS Code abierto, no lo mata sin confirmar).

**Rust**: `sysinfo` crate para listar procesos y RAM. `libc::kill` para señales.

**UI**: Tabla con checkboxes, columnas ordenables, barra de progreso de RAM total, botón "Kill Selected" y "Kill All Dev Processes".

---

### 5.2 Quarantine Remover (DevOps)

**Objetivo**: Arrastrar un `.app` y eliminar atributos de cuarentena.

**Comportamiento**:
1. Zona de drop (drag & drop) que acepta `.app`, `.dmg`, `.pkg`.
2. Ejecuta:
   - `xattr -d com.apple.quarantine <path>` (elimina cuarentena)
   - `xattr -cr <path>` (limpia recursivamente todos los atributos extendidos)
3. Verifica que el archivo existe y es un bundle de app.
4. Muestra resultado: éxito, error, o "ya estaba limpio".
5. Opción de mostrar atributos antes y después (`xattr -l`).

**Rust**: `std::process::Command` para ejecutar `xattr`. Validación con `cfbundle` o verificación de estructura `Contents/Info.plist`.

**UI**: Drop zone grande con icono, lista de archivos procesados, log de comandos ejecutados.

---

### 5.3 Network Observer (Redes) — Basado en Fieldwatch

**Objetivo**: Escaneo pasivo de WiFi APs y dispositivos BLE cercanos.

**WiFi**:
- Usa `CoreWLAN` (via `objc` bindings) para escanear redes.
- Datos por AP: SSID, BSSID, canal, banda (2.4/5/6 GHz), RSSI, seguridad (WPA2/WPA3/OWE), vendor (OUI lookup).
- Escaneo continuo o bajo demanda.
- Historial de señal por AP (gráfico de línea).

**BLE**:
- Usa `CoreBluetooth` (via `objc` bindings) para escanear advertisements.
- Datos por dispositivo: MAC (randomized o public), nombre, RSSI, servicios UUID, manufacturer data, tipo (iBeacon, Eddystone, etc.).
- Detección de AirTags y otros trackers (pattern matching en manufacturer data).

**Fingerprinting**:
- Base de datos local de OUIs (IEEE) para vendors.
- Base de datos de signatures BLE (similar a `radiodb.bin` de Fieldwatch).
- Detección de patrones: "Moving with you" (mismo dispositivo en múltiples ubicaciones/tiempos).

**Reportes**:
- Exportar a JSON, CSV, PDF.
- Resumen: total APs, total BLE, vendors únicos, canales más congestionados, dispositivos "persistentes".

**Rust**: `objc` + `core-foundation` para llamadas a CoreWLAN/CoreBluetooth. `oui` crate o base local JSON para vendors.

**UI**:
- Vista de tabla con filtros (por tipo, vendor, señal, canal).
- Vista de mapa de señal (heatmap por canal).
- Timeline de detecciones.
- Panel de detalle por dispositivo con historial de RSSI.

---

### 5.4 WiFi Mapper (Redes)

**Objetivo**: Mapear señal WiFi en un espacio físico y generar informes.

**Flujo**:
1. Usuario crea un "mapa" (canvas) y dibuja el espacio: paredes, puertas, muebles (líneas y formas básicas).
2. Usuario coloca "puntos de medición" en el canvas.
3. En cada punto, la app escanea todas las redes WiFi y registra: SSID, BSSID, RSSI, canal, ruido (si disponible), timestamp.
4. El usuario puede guardar múltiples puntos, múltiples sesiones.
5. La app genera un informe:
   - Heatmap de señal por punto.
   - Tabla de redes por punto.
   - Análisis de canales: canales más vacíos, canales con más interferencia.
   - Recomendación: mejor canal para cada punto.
   - Overlap: qué redes se sobreponen en cada punto.

**Canvas**:
- Herramientas: línea, rectángulo, círculo, texto, punto de medición.
- Zoom y pan.
- Grid opcional (10cm, 50cm, 1m).
- Guardar como JSON (coordenadas, formas, puntos).

**Escaneo**:
- `CoreWLAN` para scan completo.
- Promedio de 3 scans por punto para estabilidad.
- Guardar en SQLite: `map_id`, `point_id`, `scan_data`, `timestamp`.

**Informe**:
- Generar PDF con `printpdf` o exportar HTML.
- Incluir: mapa visual, tabla de datos, gráficos de canales, recomendaciones.
- Exportar JSON/CSV para análisis externo.

**Rust**: `CoreWLAN` para scan. `sqlx` para persistencia. `printpdf` para PDF. `serde_json` para export.

**UI**:
- Canvas SVG o Canvas API para dibujo.
- Panel lateral con herramientas y lista de puntos.
- Vista de informe con tabs: Mapa, Datos, Canales, Recomendaciones.

---

### 5.5 API Tester (Testing)

**Objetivo**: Cliente HTTP ligero integrado.

**Features**:
- Métodos: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- Headers personalizados, autocompletado de headers comunes.
- Body: JSON, form-data, x-www-form-urlencoded, raw, binary.
- Auth: Basic, Bearer, API Key (header/query), OAuth 2.0 (client credentials).
- Historial de requests guardado en SQLite.
- Colecciones: agrupar requests por proyecto.
- Environment variables: `{{base_url}}`, `{{token}}`.
- Response viewer: headers, body (pretty JSON, HTML preview, raw), timing, size.
- Guardar response como archivo.

**Rust**: `reqwest` con `rustls` para requests. `sqlx` para historial.

**UI**: Similar a Postman/Insomnia pero simplificado. Panel de request arriba, response abajo. Sidebar con historial y colecciones.

---

### 5.6 JSON Toolkit (Testing)

**Objetivo**: Manipulación completa de JSON.

**Features**:
- Formatear (pretty print con indentación configurable).
- Minificar.
- Validar (sintaxis, schema básico).
- Convertir: JSON ↔ YAML, JSON ↔ CSV, JSON ↔ TOML.
- Diff: comparar dos JSONs con diff visual (línea por línea o estructural).
- Query: JSONPath o JMESPath para extraer datos.
- Generar: JSON Schema desde JSON de ejemplo.

**Rust**: `serde_json`, `serde_yaml`, `csv`, `jsonpath_lib`, `jsonschema`.

**UI**: Editor de texto (CodeMirror o Monaco) con dos paneles (input/output), toolbar con acciones, panel de diff.

---

### 5.7 Port Manager (Redes)

**Objetivo**: Ver y gestionar puertos en uso.

**Features**:
- Lista de puertos TCP/UDP en uso (listening y established).
- Por puerto: proceso, PID, usuario, protocolo, dirección local, dirección remota, estado.
- Filtrar por puerto, proceso, protocolo.
- Matar proceso por puerto (con confirmación).
- "Who is using port X?" — input directo.

**Rust**: `sysinfo` + `netstat` parsing o `procfs` (macOS: `lsof` via `std::process::Command`).

**UI**: Tabla con filtros, input de búsqueda rápida por puerto, botón de kill por fila.

---

### 5.8 Header Analyzer (Seguridad)

**Objetivo**: Analizar headers HTTP de seguridad.

**Features**:
- Input de URL.
- Fetch headers (con redirect following opcional).
- Análisis de:
  - `Strict-Transport-Security`
  - `Content-Security-Policy`
  - `X-Frame-Options`
  - `X-Content-Type-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - Cookies (Secure, HttpOnly, SameSite)
  - CORS headers
- Score de seguridad (A-F) con recomendaciones.
- Comparación con securityheaders.com (offline, reglas locales).

**Rust**: `reqwest` para fetch. Análisis manual de headers.

**UI**: Input de URL, score grande, lista de headers con check/warning/error, recomendaciones expandibles.

---

### 5.9 SSL Inspector (Seguridad)

**Objetivo**: Inspeccionar certificados SSL/TLS.

**Features**:
- Input de dominio.
- Conexión TLS y extracción de certificado.
- Datos: emisor, sujeto, válido desde/hasta, días restantes, SANs, fingerprint (SHA256), versión TLS, cipher suite.
- Verificación de cadena (chain of trust).
- Alertas: expirado, próximo a expirar, self-signed, weak cipher, TLS < 1.2.

**Rust**: `rustls` + `webpki` para verificación. `x509-parser` para parsing.

**UI**: Input de dominio, timeline de validez, detalles del certificado, alertas destacadas.

---

### 5.10 LAN Scanner (Redes)

**Objetivo**: Descubrir dispositivos en la red local.

**Features**:
- Rango de IPs (auto-detectar subnet o manual).
- Métodos: ping (ICMP), ARP scan, TCP connect a puertos comunes (22, 80, 443, 445, 3389, 8080).
- Por host: IP, hostname (reverse DNS), MAC (via ARP), vendor (OUI), puertos abiertos, servicio estimado.
- Escaneo rápido (async, 100+ hosts en segundos).
- Guardar resultados.

**Rust**: `pnet` para ARP y packet crafting. `tokio` para async. `trust-dns-resolver` para reverse DNS.

**UI**: Input de rango, barra de progreso, tabla de resultados con badges por estado, export a CSV/JSON.

---

## 6. Modelo de Datos y Persistencia

### 6.1 Base de datos SQLite

**Ubicación**: `~/Library/Application Support/com.shift.tools/shift-tools.db`

```sql
-- Maps WiFi
CREATE TABLE wifi_maps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    canvas_data TEXT NOT NULL -- JSON: shapes, points, dimensions
);

CREATE TABLE wifi_measurements (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL REFERENCES wifi_maps(id),
    point_id TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE wifi_scans (
    id TEXT PRIMARY KEY,
    measurement_id TEXT NOT NULL REFERENCES wifi_measurements(id),
    ssid TEXT,
    bssid TEXT NOT NULL,
    rssi INTEGER NOT NULL,
    channel INTEGER,
    band TEXT,
    security TEXT,
    noise INTEGER,
    timestamp TEXT NOT NULL
);

-- Network Observer
CREATE TABLE network_observations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('wifi', 'ble')),
    mac TEXT NOT NULL,
    name TEXT,
    vendor TEXT,
    rssi INTEGER,
    channel INTEGER,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    metadata TEXT -- JSON: services, manufacturer_data, security, etc.
);

-- API Tester
CREATE TABLE api_requests (
    id TEXT PRIMARY KEY,
    collection_id TEXT,
    name TEXT NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    headers TEXT, -- JSON
    body TEXT,
    auth TEXT, -- JSON
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE api_responses (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES api_requests(id),
    status_code INTEGER,
    headers TEXT, -- JSON
    body TEXT,
    timing_ms INTEGER,
    created_at TEXT NOT NULL
);

-- Settings
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### 6.2 Exportación

| Formato | Uso | Librería |
|---------|-----|----------|
| JSON | Datos estructurados, backup | `serde_json` |
| CSV | Tablas, análisis externo | `csv` |
| PDF | Informes visuales | `printpdf` |
| HTML | Reporte navegable | Template manual |
| PNG | Capturas de canvas, gráficos | `image` + `printpdf` |

---

## 7. Plan de Implementación

### Fase 0: Setup (Día 1)

- [ ] Inicializar proyecto Tauri 2 con React + TypeScript + Tailwind.
- [ ] Configurar `tauri.conf.json` (ventana, permisos, CSP).
- [ ] Setup de Rust: dependencias base, estructura de módulos.
- [ ] Setup de frontend: routing (React Router), estado global (Zustand), componentes base.
- [ ] CI básico: build y test en GitHub Actions.

### Fase 1: Core + DevOps Tools (Días 2-4)

- [ ] Implementar Process Killer (Rust + UI).
- [ ] Implementar Quarantine Remover (Rust + UI).
- [ ] Implementar RAM Monitor (Rust + UI).
- [ ] Sidebar con categorías y routing.
- [ ] Sistema de diseño base (colores, tipografía, componentes).

### Fase 2: Testing Tools (Días 5-7)

- [ ] API Tester (Rust con reqwest + UI completa).
- [ ] JSON Toolkit (Rust + UI).
- [ ] Base64/URL Encoder (Rust + UI).
- [ ] Regex Tester (Rust con `regex` crate + UI).

### Fase 3: Redes (Días 8-12)

- [ ] LAN Scanner (Rust + UI).
- [ ] Port Manager (Rust + UI).
- [ ] DNS Toolkit (Rust + UI).
- [ ] Network Observer: WiFi scanning con CoreWLAN (Rust + UI básica).

### Fase 4: WiFi Mapper (Días 13-16)

- [ ] Canvas de dibujo (SVG/Canvas API).
- [ ] Integración con CoreWLAN para escaneo en puntos.
- [ ] Persistencia de mapas y mediciones (SQLite).
- [ ] Generación de informe (PDF + vista previa).

### Fase 5: Network Observer avanzado (Días 17-19)

- [ ] BLE scanning con CoreBluetooth.
- [ ] Fingerprinting y vendor lookup.
- [ ] Historial y timeline.
- [ ] Exportación de reportes.

### Fase 6: Seguridad (Días 20-22)

- [ ] Header Analyzer.
- [ ] SSL Inspector.
- [ ] Hash Generator.
- [ ] Password Auditor.

### Fase 7: Polish + Release (Días 23-25)

- [ ] Testing completo (unit + integration).
- [ ] Accesibilidad audit.
- [ ] Performance audit (memoria, CPU).
- [ ] Icono de app, DMG, firma y notarización.
- [ ] README y documentación de usuario.

---

## 8. Estructura del Repositorio

```
shift-tools/
├── docs/
│   └── DESIGN.md                 # Este documento
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── process.rs        # Process Killer
│   │   │   ├── quarantine.rs     # Quarantine Remover
│   │   │   ├── network/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── observer.rs   # Network Observer
│   │   │   │   ├── mapper.rs     # WiFi Mapper
│   │   │   │   ├── scanner.rs    # LAN Scanner
│   │   │   │   ├── ports.rs      # Port Manager
│   │   │   │   └── dns.rs        # DNS Toolkit
│   │   │   ├── security/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── headers.rs    # Header Analyzer
│   │   │   │   ├── ssl.rs        # SSL Inspector
│   │   │   │   └── hash.rs       # Hash Generator
│   │   │   └── testing/
│   │   │       ├── mod.rs
│   │   │       ├── api.rs        # API Tester
│   │   │       ├── json.rs       # JSON Toolkit
│   │   │       └── encode.rs     # Base64/URL
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   ├── models.rs
│   │   │   └── migrations/
│   │   ├── utils/
│   │   │   ├── mod.rs
│   │   │   ├── macos.rs          # CoreWLAN, CoreBluetooth bindings
│   │   │   └── export.rs         # PDF, CSV, JSON export
│   │   └── state.rs              # Tauri state
│   └── icons/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Table.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Progress.tsx
│   │   │   ├── Toast.tsx
│   │   │   └── index.ts
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── StatusBar.tsx
│   │   └── tools/
│   │       ├── ProcessKiller/
│   │       ├── QuarantineRemover/
│   │       ├── NetworkObserver/
│   │       ├── WifiMapper/
│   │       ├── ApiTester/
│   │       ├── JsonToolkit/
│   │       └── ...
│   ├── hooks/
│   │   ├── useTauri.ts
│   │   ├── useDebounce.ts
│   │   └── useLocalStorage.ts
│   ├── stores/
│   │   ├── appStore.ts
│   │   └── toolStore.ts
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       ├── format.ts
│       └── constants.ts
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
└── README.md
```

---

## 9. Prompt para el Agente de UI

Copia y pega esto cuando le pidas a un agente que construya la interfaz:

---

### Contexto

Estás construyendo la UI de **shift-tools**, una app macOS de herramientas para desarrolladores. El backend está en Rust con Tauri 2. Tu trabajo es el frontend: React 18 + TypeScript + Tailwind CSS + Vite.

### Diseño visual

- **Tema**: Dark mode por defecto. Fondo `#0a0a0f`. Cards con efecto glass: `bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl`.
- **Acento**: Azul macOS `#0a84ff`. Hover más claro. Focus ring visible.
- **Tipografía**: `font-sans` para UI, `font-mono` para código y datos. SF Pro / Inter.
- **Iconos**: SVG inline o lucide-react. No emojis.
- **Espaciado**: Sistema 4px. p-4, gap-4, space-y-4.
- **Animaciones**: Transiciones de 150ms en hover. Sin animaciones largas.

### Estructura de layout

```
┌────────────────────────────────────────┐
│  Header (h-12, drag region para macOS) │
├──────────┬─────────────────────────────┤
│ Sidebar  │  Main Content               │
│ (w-60)   │  (flex-1, overflow-auto)    │
│          │                             │
│ - Logo   │  ┌───────────────────────┐  │
│ - Nav    │  │ Tool Header           │  │
│   items  │  │ (title, desc, actions)│  │
│ - Status │  ├───────────────────────┤  │
│   bar    │  │                       │  │
│          │  │ Tool Content          │  │
│          │  │ (forms, tables, etc)  │  │
│          │  │                       │  │
│          │  └───────────────────────┘  │
└──────────┴─────────────────────────────┘
```

### Componentes que debes crear

1. **`Sidebar`**: Categorías colapsables, items con icono y label, indicador de tool activa.
2. **`ToolHeader`**: Título, descripción, botones de acción (export, clear, settings).
3. **`DataTable`**: Tabla con sorting, filtering, selección múltiple, acciones por fila.
4. **`LogViewer`**: Terminal-like output, auto-scroll, niveles de log (info, warn, error).
5. **`DropZone`**: Área de drag & drop con estado visual (idle, hover, processing).
6. **`CanvasMap`**: Para WiFi Mapper. SVG con zoom, pan, herramientas de dibujo.
7. **`JsonEditor`**: Editor con syntax highlighting. Puedes usar `@uiw/react-codemirror`.
8. **`ConfirmDialog`**: Modal de confirmación para acciones destructivas.
9. **`Toast`**: Notificaciones toast (éxito, error, info).
10. **`EmptyState`**: Estado vacío con icono, título, descripción, acción.

### Tools a implementar (vistas)

#### Process Killer
- Tabla de procesos con columnas: checkbox, nombre, PID, RAM (MB), CPU %, tiempo, comando.
- Filtros: texto libre, categoría (Python, Node, Rust, etc.).
- Barra superior: RAM total usada por procesos dev, botón "Kill All", botón "Kill Selected".
- Confirmación antes de kill.

#### Quarantine Remover
- DropZone grande que acepta `.app`.
- Lista de archivos procesados con resultado (éxito, error).
- Log de comandos ejecutados.

#### API Tester
- Panel izquierdo: historial y colecciones.
- Panel central: método + URL + headers + body.
- Panel derecho/abajo: response (headers, body, timing).
- Editor JSON para body y response.

#### JSON Toolkit
- Dos paneles: input y output.
- Toolbar: Format, Minify, Validate, Convert, Diff, Query.
- Modal para diff (dos inputs, output diff).

#### Network Observer
- Tabs: WiFi, BLE.
- Tabla con filtros (nombre, vendor, señal, canal).
- Panel de detalle al seleccionar fila.
- Botón "Start Scan" / "Stop Scan".

#### WiFi Mapper
- Canvas SVG central.
- Panel izquierdo: herramientas (select, line, rect, circle, point, text).
- Panel derecho: lista de puntos, datos de escaneo, botón "Scan Here".
- Botón "Generate Report".

### Comunicación con Rust

Usa `@tauri-apps/api`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Ejemplo: invocar comando
const processes = await invoke<ProcessInfo[]>('get_dev_processes');

// Ejemplo: escuchar evento
const unlisten = await listen<ScanProgress>('wifi-scan-progress', (event) => {
  setProgress(event.payload.percent);
});
```

### Reglas

- Todo el texto en inglés (la app es para uso internacional, aunque el usuario hable español).
- Accesibilidad: aria-labels, focus visible, keyboard navigation.
- No uses `any` en TypeScript. Define interfaces en `src/types/`.
- Los componentes de UI genéricos van en `src/components/ui/`.
- Los componentes de tools van en `src/components/tools/<ToolName>/`.
- Usa Zustand para estado global si es necesario, pero prefiere estado local cuando sea posible.
- Tailwind para estilos. No CSS modules, no styled-components.

---

## Anexos

### A. Permisos de Tauri necesarios

```json
{
  "tauri": {
    "allowlist": {
      "shell": { "execute": true, "open": true },
      "dialog": { "open": true, "save": true, "ask": true },
      "fs": { "readFile": true, "writeFile": true, "exists": true },
      "notification": { "all": true }
    }
  }
}
```

### B. Firma y notarización (para distribución)

```bash
# Firma
codesign --deep --force --verify --verbose --sign "Developer ID Application: <NAME>" shift-tools.app

# Notarización
xcrun notarytool submit shift-tools.dmg --apple-id <EMAIL> --team-id <TEAM> --password <APP_PASSWORD>
```

### C. Referencias

- [Tauri 2 Docs](https://v2.tauri.app/)
- [CoreWLAN Reference](https://developer.apple.com/documentation/corewlan)
- [CoreBluetooth Reference](https://developer.apple.com/documentation/corebluetooth)
- [Fieldwatch](https://github.com/OffGridPete/Fieldwatch) — inspiración para Network Observer
- [sysinfo crate](https://docs.rs/sysinfo/)
- [pnet crate](https://docs.rs/pnet/)

---

*Documento generado para shift-tools. Mantener actualizado con cada cambio de alcance.*
