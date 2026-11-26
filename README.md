# Azure Foundry · Agent Playground

Entorno de pruebas (React + Vite) para conversar con un **agente de Microsoft Foundry** a través de su
endpoint dedicado (protocolo OpenAI `responses`) con **streaming SSE** y traza de actividad, al estilo
del Agent Playground de Azure AI Foundry.

## Setup

No hay archivo `.env` y **ni endpoint ni API key se guardan en el repo**: el usuario los
introduce en la
**modal de configuración que se abre en cada carga de la página** (también se reabre con el
botón *Configuración* de la cabecera). Lo último guardado se conserva en `sessionStorage`
para precargar la modal. Por defecto solo hay `api-version=v1`
(`src/services/agentConfig.ts` → `DEFAULT_AGENT_CONFIG`).

| Campo de la modal | Descripción |
| --- | --- |
| `VITE_AZURE_FOUNDRY_AGENT_ENDPOINT` | URL completa de invocación del agente (Foundry → agente → "Test" → copiar endpoint). **Cambia cada vez que recreas el agente**; termina en `.../endpoint/protocols/openai/responses` |
| `VITE_AZURE_FOUNDRY_API_KEY` | Clave del recurso. **Cada ~2 horas**: pega la nueva en la modal. Si es un token AAD (JWT) se envía como `Authorization: Bearer` automáticamente |
| `VITE_AZURE_API_VERSION` | Versión de la API (query `?api-version=`); `v1` por defecto. Opcional si la URL ya la trae |

1. Arranca el dev server:

   ```bash
   npm run dev
   ```

2. En la modal, revisa endpoint y clave (la clave cambia cada ~2 horas) y pulsa **Guardar**.

## Estructura

- `src/services/agentConfig.ts` — configuración sin `.env`: valores por defecto en el código, carga/guardado en `sessionStorage` y cálculo de campos que faltan.
- `src/components/ConfigModal.tsx` — modal de conexión (endpoint, api key, api-version) que aparece en cada carga de página.
- `src/services/foundryService.ts` — cliente del endpoint de agente con `fetch` nativo: `streamAgentReply()` hace el POST con `stream: true`, parsea los eventos SSE (`response.created`, `response.output_text.delta`, `response.output_item.done`, `response.completed`…) y gestiona la conversación con `agent_session_id` + `previous_response_id`.
- `src/components/FoundryPlayground.tsx` — chat con streaming en vivo (burbuja del asistente que se rellena delta a delta), panel de **Actividad** (peticiones, tools invocadas por el agente, respuesta final con id y duración, errores), cancelación de peticiones y "Nueva conversación" (reset de sesión).

Las tools las ejecuta **el agente en servidor**: no hay editor de tools ni ejecución local.

## Scripts

```bash
npm run dev      # desarrollo con HMR
npm run build    # typecheck (tsc -b) + build de producción
npm run lint     # oxlint
```
