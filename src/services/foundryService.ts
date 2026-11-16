/**
 * Capa de servicio para Azure AI Foundry (Chat Completions + tool calling)
 * usando `fetch` nativo: sin SDK, sin dependencias extra.
 *
 * Soporta los dos formatos de endpoint habituales:
 *  - Azure OpenAI clásico : https://<recurso>.openai.azure.com
 *  - Foundry Models       : https://<recurso>.services.ai.azure.com/models
 */

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ToolRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ToolRole
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface FoundryConfig {
  endpoint: string
  apiKey: string
  deployment: string
  apiVersion: string
}

/** Ejecuta una tool local y devuelve un resultado serializable a JSON. */
export type ToolExecutor = (name: string, argsJson: string) => Promise<unknown>

export type PlaygroundEvent =
  | { type: 'request'; at: number; round: number; messageCount: number; toolCount: number }
  | { type: 'tool_calls'; at: number; round: number; toolCalls: ToolCall[] }
  | {
      type: 'tool_result'
      at: number
      round: number
      toolCallId: string
      name: string
      arguments: string
      result: string
      durationMs: number
      error?: string
    }
  | { type: 'final'; at: number; round: number; content: string }
  | { type: 'error'; at: number; message: string }

export interface ChatWithToolsOptions {
  messages: ChatMessage[]
  tools: ToolDefinition[]
  executeTool: ToolExecutor
  onEvent?: (event: PlaygroundEvent) => void
  maxRounds?: number
  temperature?: number
  signal?: AbortSignal
}

export interface ChatWithToolsResult {
  /** Historial completo: incluye assistant con tool_calls y mensajes role:"tool". */
  messages: ChatMessage[]
  finalMessage: ChatMessage
  rounds: number
}

export function readFoundryConfig(): { config: FoundryConfig; missing: string[] } {
  const endpoint = import.meta.env.VITE_AZURE_FOUNDRY_ENDPOINT ?? ''
  const apiKey = import.meta.env.VITE_AZURE_FOUNDRY_API_KEY ?? ''
  const deployment = import.meta.env.VITE_AZURE_DEPLOYMENT_NAME ?? ''
  const apiVersion = import.meta.env.VITE_AZURE_API_VERSION ?? ''

  const missing: string[] = []
  if (!endpoint.trim()) missing.push('VITE_AZURE_FOUNDRY_ENDPOINT')
  if (!apiKey.trim()) missing.push('VITE_AZURE_FOUNDRY_API_KEY')
  if (!deployment.trim()) missing.push('VITE_AZURE_DEPLOYMENT_NAME')
  if (!apiVersion.trim()) missing.push('VITE_AZURE_API_VERSION')

  return {
    config: { endpoint: endpoint.trim(), apiKey: apiKey.trim(), deployment: deployment.trim(), apiVersion: apiVersion.trim() },
    missing,
  }
}

/**
 * Construye la URL de Chat Completions a partir del endpoint configurado.
 * Si el endpoint no encaja con un patrón conocido se asume una base OpenAI
 * compatible y se añade `/chat/completions`.
 */
export function buildChatCompletionsUrl(config: FoundryConfig): string {
  const endpoint = config.endpoint.replace(/\/+$/, '')
  const version = config.apiVersion
  const query = version ? `?api-version=${encodeURIComponent(version)}` : ''

  if (/\/chat\/completions$/i.test(endpoint)) return `${endpoint}${query}`

  // Azure OpenAI v1 (OpenAI-compatible): .../openai/v1/chat/completions
  if (/\/openai\/v\d+(\/preview)?$/i.test(endpoint)) {
    return `${endpoint}/chat/completions${query}`
  }

  // Azure OpenAI clásico: /openai/deployments/{deployment}/chat/completions
  if (/(^|\/\/)[^/]*\.openai\.azure\.com(\/|$)/i.test(endpoint) || /\/openai\/deployments\//i.test(endpoint)) {
    if (/\/openai\/deployments\/[^/]+$/i.test(endpoint)) {
      return `${endpoint}/chat/completions${query}`
    }
    return `${endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions${query}`
  }

  // Azure AI Foundry Models (Model Inference API): /models/chat/completions
  if (/\.services\.ai\.azure\.com/i.test(endpoint) || /\/models$/i.test(endpoint)) {
    return `${endpoint}/chat/completions${query}`
  }

  // Núcleo OpenAI-compatible (p. ej. http://localhost:1234/v1)
  if (/\/openai\/v\d/i.test(endpoint) || /\/v\d$/i.test(endpoint)) {
    return `${endpoint}/chat/completions${query}`
  }

  return `${endpoint}/chat/completions${query}`
}

interface ChatCompletionsResponse {
  choices?: Array<{
    index?: number
    message?: {
      role?: string
      content?: string | null
      tool_calls?: ToolCall[]
    }
    finish_reason?: string
  }>
  error?: { message?: string }
}

/** Una única llamada a Chat Completions. */
async function chatCompletion(
  config: FoundryConfig,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ChatCompletionsResponse> {
  const url = buildChatCompletionsUrl(config)

  let response: Response
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(config.apiKey)) {
    headers.Authorization = `Bearer ${config.apiKey}` // token AAD (JWT)
  } else if (config.apiKey) {
    headers['api-key'] = config.apiKey // clave clásica de Azure OpenAI
  }
  try {
    response = await fetch(url, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new Error(`No se pudo contactar con el endpoint (${url}): ${errorMessage(error)}`)
  }

  const text = await response.text()
  let data: ChatCompletionsResponse | null = null
  try {
    data = text ? (JSON.parse(text) as ChatCompletionsResponse) : null
  } catch {
    data = null
  }

  if (!response.ok) {
    const detail = data?.error?.message ?? text.slice(0, 400)
    throw new Error(`Azure devolvió HTTP ${response.status}: ${detail}`)
  }
  if (!data) throw new Error('Respuesta no-JSON del endpoint de Azure')
  return data
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Ciclo completo de tool calling:
 * 1. envía historial + definiciones `tools`
 * 2. si la respuesta contiene `tool_calls`, ejecuta las funciones locales
 * 3. devuelve los mensajes con `role: "tool"` al historial
 * 4. repite hasta obtener una respuesta final sin tool_calls
 */
export async function chatWithTools(options: ChatWithToolsOptions): Promise<ChatWithToolsResult> {
  const { config, missing } = readFoundryConfig()
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`)
  }

  const maxRounds = options.maxRounds ?? 5
  const history: ChatMessage[] = options.messages.map((message) => ({ ...message }))
  const emit = options.onEvent ?? (() => undefined)

  for (let round = 1; round <= maxRounds; round++) {
    const body: Record<string, unknown> = {
      messages: history,
    }
    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.tools.length > 0) {
      body.tools = options.tools
      body.tool_choice = 'auto'
    }
    // Tanto la Model Inference API como OpenAI v1 requieren el modelo en el body.
    if (/\/openai\/v\d/i.test(config.endpoint) || /services\.ai\.azure\.com|\/models$/i.test(config.endpoint)) {
      body.model = config.deployment
    }

    emit({ type: 'request', at: Date.now(), round, messageCount: history.length, toolCount: options.tools.length })

    const data = await chatCompletion(config, body, options.signal)
    const message = data.choices?.[0]?.message
    if (!message) throw new Error('La respuesta no contiene choices[0].message')

    const toolCalls = message.tool_calls ?? []

    if (toolCalls.length === 0) {
      const finalMessage: ChatMessage = {
        role: 'assistant',
        content: message.content ?? '',
      }
      history.push(finalMessage)
      emit({ type: 'final', at: Date.now(), round, content: finalMessage.content ?? '' })
      return { messages: history, finalMessage, rounds: round }
    }

    history.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: toolCalls,
    })
    emit({ type: 'tool_calls', at: Date.now(), round, toolCalls })

    for (const call of toolCalls) {
      const startedAt = performance.now()
      let result = ''
      let error: string | undefined
      try {
        const value = await options.executeTool(call.function.name, call.function.arguments)
        result = JSON.stringify(value, null, 2)
      } catch (execError) {
        error = errorMessage(execError)
        result = JSON.stringify({ error })
      }
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
      })
      emit({
        type: 'tool_result',
        at: Date.now(),
        round,
        toolCallId: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        result,
        durationMs: Math.round(performance.now() - startedAt),
        error,
      })
    }
  }

  throw new Error(`El ciclo de tool calling superó las ${maxRounds} rondas sin respuesta final`)
}
