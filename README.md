# Azure Foundry · Agent Playground

Entorno de pruebas (React + Vite) para conversar con un **agente de Microsoft Foundry** a través de su
endpoint dedicado (protocolo OpenAI `responses`) con **streaming SSE** y traza de actividad, al estilo
del Agent Playground de Azure AI Foundry.

## Setup

1. Copia la plantilla de variables de entorno y rellénala con tus credenciales:

   ```bash
   cp .env.example .env
   ```

   | Variable | Descripción |
   | --- | --- |
   | `VITE_AZURE_FOUNDRY_AGENT_ENDPOINT` | URL completa de invocación del agente (Foundry → agente → "Test" → copiar endpoint). **Cambia cada vez que recreas el agente**; termina en `.../endpoint/protocols/openai/responses` |
   | `VITE_AZURE_FOUNDRY_API_KEY` | Clave del recurso. Si es un token AAD (JWT) se envía como `Authorization: Bearer` automáticamente |
   | `VITE_AZURE_API_VERSION` | Versión de la API (query `?api-version=`); `v1` por defecto. Opcional si la URL ya la trae |
   | `VITE_AZURE_DEPLOYMENT_NAME` | Opcional: modelo a enviar en el body si el agente lo exige |

   > `.env` está en `.gitignore`: no subas claves al repo.

2. Arranca el dev server:

   ```bash
   npm run dev
   ```

## Estructura

- `src/services/foundryService.ts` — cliente del endpoint de agente con `fetch` nativo: `streamAgentReply()` hace el POST con `stream: true`, parsea los eventos SSE (`response.created`, `response.output_text.delta`, `response.output_item.done`, `response.completed`…) y gestiona la conversación con `agent_session_id` + `previous_response_id`.
- `src/components/FoundryPlayground.tsx` — chat con streaming en vivo (burbuja del asistente que se rellena delta a delta), panel de **Actividad** (peticiones, tools invocadas por el agente, respuesta final con id y duración, errores), cancelación de peticiones y "Nueva conversación" (reset de sesión).

Las tools las ejecuta **el agente en servidor**: no hay editor de tools ni ejecución local.

## Scripts

```bash
npm run dev      # desarrollo con HMR
npm run build    # typecheck (tsc -b) + build de producción
npm run lint     # oxlint
```
