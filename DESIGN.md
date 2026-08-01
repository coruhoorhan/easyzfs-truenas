# DESIGN.md — EasyZFS

## Discovery

- **Artefacto**: dashboard/herramienta de administración (pro tool) para ZFS, PWA
  self-hosted que vive en el propio NAS. Densidad media-alta, datos primero.
- **Audiencia**: homelab/admin técnico (repo OSS público). Posicionamiento: técnico,
  sobrio, fiable — una herramienta de consola con buena cara, no una landing.
- **Adjetivos de marca**: sobrio, preciso, técnico, honesto.
- **Esencia (3 palabras)**: instrumento de consola.

## Dirección estética

Pulido de la base existente (verde sobre crema / verde menta sobre casi-negro),
sin rediseño de identidad. La app ya tenía un sistema de tokens CSS por tema
correcto; el trabajo es quitar los tells genéricos: fuente del sistema, borde +
sombra apilados, datos técnicos sin monoespaciada, violeta en el picker.

**Signature move**: los datos técnicos (pools, vdevs, series, rutas, comandos)
van SIEMPRE en JetBrains Mono — la app se lee como una consola bien tipografiada,
con Space Grotesk para la voz de la interfaz.

## Tipografía

- **Display + body**: Space Grotesk (400/500/600/700), self-hosted (@fontsource,
  funciona offline en LAN). Geométrica con carácter, legible a 13-15px.
- **Datos**: JetBrains Mono (400/500/600) para nombres de pool/disco/dataset,
  series, rutas, comandos cron, tamaños y temps en tablas.
- Escala: base 13.5-14.5px, h1 22px/700, h2 sección 15px/700, labels 11-12px
  uppercase tracking .05em (existente, se mantiene).

## Color

- Sistema existente se mantiene: neutros verdosos (bg crema `#f6f6f3` /
  dark `#0e1210`), semánticos ok/warn/err/info.
- **Acento: picker de 4 en Ajustes (se conserva, decisión del usuario)** con
  opciones curadas: `emerald` (defecto), `cyan`, `amber`, `steel` (nuevo, azul
  acero `#3a6ea5` / dark `#7ba7d9`). **Violeta eliminado** (banda índigo/violeta
  = red ocean de UI generativa).
- Cada acento define par [accent, accent-soft] por tema (light/dark).

## Tokens

| Token | Valor | Nota |
|---|---|---|
| `--font-sans` | 'Space Grotesk', system-ui, sans-serif | voz de la UI |
| `--font-mono` | 'JetBrains Mono', ui-monospace, monospace | datos técnicos |
| `--radius` | 12px | tarjetas y paneles |
| `--radius-sm` | 8px | controles (botones, inputs, chips) |
| sombra | SOLO overlays (modal, popover alertas) | tarjetas: borde XOR sombra |
| `--shadow` | 0 8px 28px rgba(10,14,10,.18) | elevación de overlays |

**Regla borde-XOR-sombra**: un elemento en reposo lleva borde hairline O sombra
suave, nunca ambos. Las tarjetas pierden `box-shadow` (ya tienen borde).

## Craft

- **Tablas**: columnas numéricas (tamaño, temp, horas) alineadas a la derecha con
  `font-variant-numeric: tabular-nums`; nombres de dispositivo en mono.
- **Botones**: jerarquía por importancia (primary solo para la acción principal
  de cada vista/modal; ghost para el resto; danger solo texto).
- **Estados**: hover/disabled/focus-visible ya existentes; se mantiene el
  `:focus-visible` con outline de acento.
- **Movimiento**: fade de vista 180ms, modal 220ms, `prefers-reduced-motion`
  respetado (ya implementado). Sin animaciones en acciones de alta frecuencia.
- **Iconografía**: set inline propio (stroke coherente) — se mantiene.
- **Dark mode**: diseñado por tema (no invertido), acentos desaturados en dark
  (los pares de ACCENTS ya lo hacen).

## Slop-audit (1-Ago-2026)

| Tell | Estado |
|---|---|
| Fuente del sistema/Inter como principal | CORREGIDO → Space Grotesk |
| Borde + sombra difusa apilados | CORREGIDO → tarjetas solo borde |
| Radius >16px en tarjetas | OK (14→12) |
| Violeta en picker de acento | CORREGIDO → steel |
| Datos técnicos sin mono | CORREGIDO → JetBrains Mono |
| Columnas numéricas centradas/no tabulares | CORREGIDO → derecha + tabular-nums |
| Cream bg por reflejo | ACEPTADO consciente (base aprobada, tema dark alternativo) |

## Changelog

- 1-Ago-2026: primera pasada de la skill frontend-design-deslop (tokens, tipografía,
  acentos curados, tablas numéricas, borde-XOR-sombra).
