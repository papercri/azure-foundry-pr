# Azure AI Foundry · Tool Calling Playground — Explicación y manual de uso

Entorno de pruebas (React + Vite + TypeScript) para experimentar con *function calling* / *tools* de Azure AI Foundry, sin SDK: todo se hace con `fetch` nativo.

---

## 1. Puesta en marcha

```bash
npm install
cp .env.example .env   # si aún no existe
npm run dev            # http://localhost:5173
```

### Variables de entorno (`.env`)

| Variable | Descripción | Ejemplo |
| --- | --- | --- |
| `VITE_AZURE_FOUNDRY_ENDPOINT` | Endpoint del recurso. Formas soportadas: | `https://mi-recurso.openai.azure.com/openai/v1` (recomendado) |
| | - Azure OpenAI **v1** (OpenAI-compatible) | `https://mi-recurso.openai.azure.com/openai/v1` |
| | - Azure OpenAI **clásico** (deployments) | `https://mi-recurso.openai.azure.com` |
| | - Foundry **Model Inference** | `https://mi-recurso.services.ai.azure.com/models` |
| `VITE_AZURE_FOUNDRY_API_KEY` | Clave del recurso (o token AAD con forma de JWT) | `abc123...` |
| `VITE_AZURE_DEPLOYMENT_NAME` | Nombre del deployment/modelo | `gpt-5.1` |
| `VITE_AZURE_API_VERSION` | Versión de la API REST | `v1` (para `/openai/v1`) o `2024-10-21` (clásico) |

- `.env` está en `.gitignore`: **nunca se commitea**.
- Vite solo lee `.env` al arrancar: tras editarlo, reinicia `npm run dev`.
- Si falta alguna variable, la app muestra un banner naranja con las que faltan y bloquea el envío.

### Scripts

```bash
npm run dev      # desarrollo con HMR
npm run build    # typecheck (tsc -b) + build de producción
npm run lint     # oxlint
npm run preview  # sirve dist/
```

---

## 2. Arquitectura

```
src/
├── App.tsx                       # monta el playground (app de una sola vista)
├── vite-env.d.ts                 # tipado de import.meta.env.VITE_*
├── services/
│   ├── foundryService.ts         # cliente Azure + ciclo de tool calling
│   └── mockTools.ts              # tools de ejemplo: schemas + ejecutores
└── components/
    ├── FoundryPlayground.tsx     # UI de 3 zonas
    └── FoundryPlayground.css     # estilos del panel
```

### Flujo de datos

```
.env ──► readFoundryConfig() ──► buildChatCompletionsUrl() ──► POST /chat/completions (Azure)
                                        ▲
FoundryPlayground ──► chatWithTools() ──┘
  (historial + tools)       │
                            ├─ 1ª vuelta: envía messages + tools + tool_choice:"auto"
                            ├─ ¿respuesta con tool_calls? → executeTool() local
                            ├─ añade mensajes role:"tool" al historial
                            └─ 2ª vuelta: respuesta final (máx. 5 rondas)
```

### Capa de servicios — `src/services/foundryService.ts`

| Función | Línea | Qué hace |
| --- | --- | --- |
| `readFoundryConfig()` | 81 | Lee las 4 variables de `import.meta.env` y devuelve `{ config, missing[] }`. |
| `buildChatCompletionsUrl()` | 104 | Construye la URL según el estilo del endpoint: `/openai/v1/chat/completions`, `/openai/deployments/{d}/chat/completions` o `/models/chat/completions`. Acepta también endpoints que ya traigan `/chat/completions`. |
| `chatCompletion()` | 151 | Un único POST con `fetch`: headers (`Content-Type`, `api-key` o `Authorization: Bearer` si la clave parece JWT/AAD), parseo de errores de Azure (401, `DeploymentNotFound`, content filter) a mensajes legibles. |
| `chatWithTools()` | 203 | **El ciclo completo de tool calling.** Ver §3. |

**Tipos principales:** `ChatMessage` (`role`: `system | user | assistant | tool`), `ToolDefinition` (JSON Schema), `ToolCall`, `PlaygroundEvent` (union de eventos del inspector), `ToolExecutor`.

**Autenticación:** si `VITE_AZURE_FOUNDRY_API_KEY` parece un JWT (`aaa.bbb.ccc`) se envía `Authorization: Bearer …` (Entra ID/AAD); si no, se envía `api-key: …` (clave clásica).

### Tools — `src/services/mockTools.ts`

| Tool | Parámetros | Implementación |
| --- | --- | --- |
| `get_order_status` | `orderId` (req) | Lookup en tabla mock (`A-1024` in_transit, `B-7781` delivered, `C-3390` processing); si no existe devuelve `found:false` + hint de IDs válidos. |
| `get_weather` | `city` (req), `unit` enum | Mock determinístico: hash de la ciudad → condición y temperatura. |
| `get_current_time` | `timezone` opcional | Función real con `Intl.DateTimeFormat` (IANA, por defecto UTC). |

- `DEFAULT_TOOLS`: array de definiciones listo para enviar.
- `DEFAULT_TOOLS_JSON`: lo mismo serializado, contenido inicial del editor.
- `executeTool(name, argsJson)` (línea 200): resuelve nombre → executor; valida los argumentos (`asObject`, `requireString`) y **lanza error** si la tool no existe o los argumentos son inválidos (ese error se envía al modelo como contenido del mensaje `role:"tool"`).

---

## 3. Ciclo de tool calling (el corazón del asistente)

Dentro de `chatWithTools()` (foundryService.ts:203), por cada ronda (máx. 5):

1. **Request**: `POST` con `messages` (historial completo), `tools` (si las hay), `tool_choice: "auto"` y `model` cuando el estilo de endpoint lo exige (v1 / model-inference). Se emite el evento `request` (ronda, nº de mensajes, nº de tools).
2. **Respuesta**: si `choices[0].message.tool_calls` está vacío → es la **respuesta final**: se añade al historial y se emite `final`.
3. **Si hay `tool_calls`**:
   - se añade el mensaje `assistant` con `content` + `tool_calls` al historial;
   - se emite el evento `tool_calls` (IDs, nombres, argumentos crudos);
   - por cada llamada se ejecuta `executeTool()` local, se cronometra y se añade un mensaje **`role: "tool"`** con `tool_call_id` y el resultado JSON;
   - se emite `tool_result` (argumentos, retorno, duración en ms, error si lo hubo);
   - se vuelve al paso 1 con el historial enriquecido.
4. Si se superan las 5 rondas sin respuesta final → error.

Estructura del historial tras un turno con 2 tools:

```
system → user → assistant(tool_calls ×2) → tool → tool → assistant(final)
```

---

## 4. La interfaz — `FoundryPlayground.tsx`

Panel dividido en tres zonas (rejilla CSS de 3 columnas; en pantallas < 1100px se apilan):



### Centro · Chat
- Historial con burbujas por rol: `system` (dashed, centrada), `user` (acento, derecha), `assistant` (fondo código, izquierda), `tool` (monoespaciado, retorno JSON).
- Indicador "El modelo está decidiendo si llama tools…" mientras `busy`.
- Al arrancar muestra 3 **sugerencias** de un clic.
- Input: `Enter` envía · `Shift+Enter` salto de línea · botón **Enviar**.
- **Nueva conversación** → resetea chat e inspector.

### Derecha · Inspector de tool calls
Traza en tiempo real cada turno, en orden:

| Badge | Contenido |
| --- | --- |
| `request #N` | ronda, nº de mensajes enviados y nº de tools |
| `tool_calls ×N` | JSON crudo de las llamadas (id, function.name, function.arguments) |
| `nombre · Xms` | **argumentos que eligió el modelo** + **retorno de tu función**, con duración (rojo si hubo error) |
| `respuesta final` | contenido final del asistente |
| `error` | fallo de red/Azure/validación |

- Botón **Limpiar** → vacía solo el inspector (el chat se conserva).
- Los tiempos son `HH:MM:SS.mmm`.

---

## 5. Manual de uso — qué testear hoy

1. Arranca `npm run dev` y abre el navegador.
2. **Function calling básico** — escribe `¿Cuál es el estado del pedido A-1024?`:
   - inspector: `request #1` → `tool_calls` con `{"orderId":"A-1024"}` → `get_order_status · Xms` con el retorno → `request #2` → `respuesta final`.
3. **Parallel tool calls** — `¿Cuál es el estado de A-1024 y qué tiempo hace en Madrid en celsius?` → dos `tool_result` en la misma ronda.
4. **Schema en caliente** — cambia el `description` o haz obligatorio `unit` en `get_weather` dentro del editor y observa cómo cambian los argumentos que manda el modelo en el inspector.
5. **Tool inexistente** — renómbrala en el JSON a `get_pepe` (el JSON sigue siendo válido): el modelo la invocará, el executor lanza `Tool desconocida`, ese error viaja como contenido `role:"tool"` y verás en la ronda 2 cómo el modelo se recupera y responde.
6. **Argumentos inválidos** — borra el `required` y escribe `{"orderId": 123}` a mano vía un prompt forzado → `requireString` lanza el error y también se devuelve al modelo.
7. **Diagnóstico de errores**:
   - clave mal → `Azure devolvió HTTP 401…` en el chat + evento `error` en rojo;
   - deployment inexistente → `DeploymentNotFound`;
   - endpoint mal → mensaje de red/URL;
   - variables faltantes → banner naranja + botón Enviar deshabilitado.
8. **Cambiar de modelo/versión/endpoint** → edita `.env` y reinicia el dev server.
9. **Reset** → *Nueva conversación* (chat) / *Limpiar* (inspector) / *Restaurar* (tools).

> Nota: en este recurso solo `gpt-5.1` y `model-router` tienen deployment activo (este último con cuota inicializando). Modelos como `gpt-4o-mini`, `gpt-4.1` o `gpt-5-mini` devuelven `DeploymentNotFound`.

---

## 6. Cómo ampliar el testeo de features de Azure

| Feature | Dónde tocar |
| --- | --- |
| **`tool_choice`** | `foundryService.ts:220`: `'auto'` → `'none'`, `'required'` o `{"type":"function","function":{"name":"get_weather"}}` para vetar/forzar una tool. |
| **Nuevas tools** | Añade el JSON en el editor (y en `DEFAULT_TOOLS` si quieres persistencia del default) + registra el executor en el mapa `executors` de `mockTools.ts`. |
| **Tools sin executor** | No hagas nada: sirve para probar el flujo de error `Tool desconocida`. |
| **Modelos de razonamiento** | `gpt-5.6+` con tools en Chat Completions requiere `reasoning_effort: "none"` en el body de `chatWithTools()`. |
| **Temperatura / sampling** | `chatWithTools()` acepta `options.temperature`; solo se envía si se pasa (algunos modelos rechazan `temperature`). |
| **Content filter** | Envía un prompt bloqueado y lee `content_filter_results` / el error 400 en el inspector. |
| **Auth con Entra ID (AAD)** | Pon un token JWT como `VITE_AZURE_FOUNDRY_API_KEY`: se envía `Authorization: Bearer` automáticamente. |
| **Más de una ronda / bucles largos** | `maxRounds` de `chatWithTools()` (por defecto 5). |
| **Cancelar peticiones** | `chatWithTools()` ya acepta `options.signal` (AbortSignal); conectarlo a un botón "Cancelar" en la UI. |
| **Structured outputs** | Añadir `response_format: { type: "json_schema", … }` al body. |
| **Streaming (SSE)** | Aún no implementado: `stream: true` + parseo de `data:` chunks; habría que remodelar los eventos del inspector. |
| **Embeddings / imágenes / audio** | Endpoints distintos (`/embeddings`, `/images/generations`): requiere otra función de servicio + otra zona de UI. |
| **Multi-turno persistente** | Guardar `messages` en `localStorage` (hoy todo muere al recargar). |

---

## 7. Limitaciones y seguridad

- **Sin streaming** (respuestas solo al final), **sin persistencia** (recargar limpia chat e inspector).
- **La API key viaja en el bundle del navegador**: válido solo para pruebas locales. `.env` está en `.gitignore`; si la clave queda expuesta en un chat/commit, regenerarla en el portal de Azure.
- Solo Chat Completions; el endpoint de proyecto (`…/api/projects/…`) **no** funciona con API-key (devuelve `API version not supported` / `404` / requiere permisos AAD `models/read`) — usar el endpoint de Azure OpenAI.
- El mock de `get_weather` es determinístico (no llama a ningún servicio real).

---

## 8. Verificación

Comprobado contra el recurso real (endpoint `/openai/v1`, modelo `gpt-5.1`):

- Ciclo E2E: 1 prompt con 2 tools → `tool_calls` en paralelo → 2 mensajes `role:"tool"` → 2ª ronda → respuesta final correcta.
- Historial resultante: `system → user → assistant → tool → tool → assistant`.
- Headers `api-key` y `Authorization: Bearer` juntos → HTTP 200.
- `npm run lint` (oxlint) ✓ · `npx tsc -b` ✓ · `npm run build` ✓ · dev server responde 200 ✓.
