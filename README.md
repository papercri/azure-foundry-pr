# Azure Foundry · Tool Calling Playground

Entorno de pruebas (React + Vite) para experimentar con *function calling* / *tools* de Azure AI Foundry.

## Setup

1. Copia la plantilla de variables de entorno y rellénala con tus credenciales:

   ```bash
   cp .env.example .env
   ```

   | Variable | Descripción |
   | --- | --- |
   | `VITE_AZURE_FOUNDRY_ENDPOINT` | `https://<recurso>.openai.azure.com/openai/v1` (recomendado), `https://<recurso>.openai.azure.com` o `https://<recurso>.services.ai.azure.com/models` |
   | `VITE_AZURE_FOUNDRY_API_KEY` | Clave del recurso |
   | `VITE_AZURE_DEPLOYMENT_NAME` | Nombre del deployment (p. ej. `gpt-5.1`) |
   | `VITE_AZURE_API_VERSION` | `v1` para el endpoint `/openai/v1`, o fecha para el clásico (p. ej. `2024-10-21`) |

   > `.env` está en `.gitignore`: no subas claves al repo.

2. Arranca el dev server:

   ```bash
   npm run dev
   ```

## Estructura

- `src/services/foundryService.ts` — cliente Chat Completions con `fetch` nativo y el ciclo completo de *tool calling* (envío de `tools`, detección de `tool_calls`, ejecución local y mensajes `role: "tool"` de vuelta al historial).
- `src/services/mockTools.ts` — 3 tools de ejemplo con sus esquemas JSON y ejecutadores (`get_order_status`, `get_weather`, `get_current_time`).
- `src/components/FoundryPlayground.tsx` — panel con editor JSON de tools, chat interactivo e inspector de `tool_calls` (argumentos y retornos en tiempo real).

## Scripts

```bash
npm run dev      # desarrollo con HMR
npm run build    # typecheck (tsc -b) + build de producción
npm run lint     # oxlint
```

> Nota: con modelos de razonamiento tipo `gpt-5*` en Chat Completions puede ser necesario fijar `reasoning_effort` a `none` para que las function tools funcionen.
