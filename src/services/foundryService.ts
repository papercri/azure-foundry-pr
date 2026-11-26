/**
 * Capa de servicio para el endpoint de agente de Azure AI Foundry
 * (protocolo OpenAI Responses) usando `fetch` nativo: sin SDK, sin dependencias extra.
 *
 * La URL cambia cada vez que se recrea el agente: se configura en la modal de
 * conexión (o en DEFAULT_AGENT_CONFIG) y termina en
 * .../api/projects/{proj}/agents/{agente}/endpoint/protocols/openai/responses
 */

import { loadAgentConfig, missingConfigFields, type AgentConfig } from './agentConfig'

export type { AgentConfig }


export type PlaygroundEvent =
  | { type: 'request'; at: number; round: number; input: string; sessionId?: string; previousResponseId?: string }
  | { type: 'response_created'; at: number; responseId: string }
  | {
      type: 'output_item'
      at: number
      kind: 'function_call' | 'reasoning' | 'other'
      name?: string
      callId?: string
      payload: unknown
    }
  | { type: 'final'; at: number; content: string; responseId?: string; durationMs: number }
  | { type: 'error'; at: number; message: string }

export interface StreamAgentOptions {
  input: string
  round?: number
  agentSessionId?: string
  previousResponseId?: string
  onEvent?: (event: PlaygroundEvent) => void
  onTextDelta?: (delta: string) => void
  signal?: AbortSignal
}

export interface StreamAgentResult {
  text: string
  responseId?: string
  agentSessionId?: string
  durationMs: number
}

export function readAgentConfig(): { config: AgentConfig; missing: string[] } {
  const config = loadAgentConfig()
  return { config, missing: missingConfigFields(config) }
}

/** Añade ?api-version= a la URL del agente si no lo trae ya. */
export function buildAgentUrl(config: AgentConfig): string {
  const endpoint = config.endpoint.replace(/\/+$/, '')
  if (!config.apiVersion || /[?&]api-version=/.test(endpoint)) return endpoint
  return `${endpoint}?api-version=${encodeURIComponent(config.apiVersion)}`
}

function buildHeaders(config: AgentConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(config.apiKey)) {
    headers.Authorization = `Bearer ${config.apiKey}` // token AAD (JWT)
  } else if (config.apiKey) {
    headers['api-key'] = config.apiKey // clave clásica de Azure
  }
  return headers
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ResponsesApiEvent {
  type?: string
  delta?: string
  response?: {
    id?: string
    agent_session_id?: string
    error?: { message?: string }
    output?: unknown[]
  }
  item?: {
    type?: string
    id?: string
    call_id?: string
    name?: string
    arguments?: string
    summary?: unknown
  }
  error?: { message?: string } | string
}

function apiErrorMessage(payload: ResponsesApiEvent): string | undefined {
  if (typeof payload.error === 'string') return payload.error
  if (payload.error && typeof payload.error === 'object' && 'message' in payload.error) {
    return payload.error.message
  }
  return payload.response?.error?.message
}

function extractTextFromJson(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string') return data.output_text
  const output = Array.isArray(data.output) ? data.output : []
  const parts: string[] = []
  for (const item of output) {
    const candidate = item as { type?: string; content?: Array<{ type?: string; text?: string }> }
    if (candidate?.type !== 'message' || !Array.isArray(candidate.content)) continue
    for (const part of candidate.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') parts.push(part.text)
    }
  }
  return parts.join('')
}

function dispatchStreamEvent(
  payload: ResponsesApiEvent,
  state: { text: string; responseId?: string; agentSessionId?: string },
  options: StreamAgentOptions,
): string | null {
  const emit = options.onEvent ?? (() => undefined)

  switch (payload.type) {
    case 'response.created': {
      const responseId = payload.response?.id
      if (responseId) {
        state.responseId = responseId
        emit({ type: 'response_created', at: Date.now(), responseId })
      }
      if (payload.response?.agent_session_id) state.agentSessionId = payload.response.agent_session_id
      return null
    }
    case 'response.output_text.delta': {
      const delta = payload.delta ?? ''
      if (delta) {
        state.text += delta
        options.onTextDelta?.(delta)
      }
      return null
    }
    case 'response.output_item.done': {
      const item = payload.item
      if (!item) return null
      if (item.type === 'function_call' || item.type === 'custom_tool_call') {
        emit({
          type: 'output_item',
          at: Date.now(),
          kind: 'function_call',
          name: item.name,
          callId: item.call_id ?? item.id,
          payload: item,
        })
      } else if (item.type === 'reasoning') {
        emit({ type: 'output_item', at: Date.now(), kind: 'reasoning', payload: item })
      } else if (item.type !== 'message') {
        emit({ type: 'output_item', at: Date.now(), kind: 'other', payload: item })
      }
      return null
    }
    case 'response.completed': {
      if (payload.response?.id) state.responseId = payload.response.id
      if (payload.response?.agent_session_id) state.agentSessionId = payload.response.agent_session_id
      return null
    }
    case 'response.failed':
    case 'error': {
      return apiErrorMessage(payload) ?? 'El agente devolvió un evento de error'
    }
    default:
      return null
  }
}

/**
 * Envía un turno al agente con streaming SSE y devuelve el texto acumulado.
 * Emite eventos al inspector (onEvent) y deltas de texto (onTextDelta).
 */
export async function streamAgentReply(options: StreamAgentOptions): Promise<StreamAgentResult> {
  const { config, missing } = readAgentConfig()
  if (missing.length > 0) throw new Error(`Faltan datos de conexión: ${missing.join(', ')}`)

  const url = buildAgentUrl(config)
  const body: Record<string, unknown> = { input: options.input, stream: true }
  if (config.model) body.model = config.model
  if (options.agentSessionId) body.agent_session_id = options.agentSessionId
  if (options.previousResponseId) body.previous_response_id = options.previousResponseId

  const startedAt = performance.now()
  const emit = options.onEvent ?? (() => undefined)

  emit({
    type: 'request',
    at: Date.now(),
    round: options.round ?? 1,
    input: options.input,
    sessionId: options.agentSessionId,
    previousResponseId: options.previousResponseId,
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: options.signal,
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    })
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Petición cancelada')
    throw new Error(`No se pudo contactar con el endpoint (${url}): ${errorMessage(error)}`)
  }

  // Cabecera de sesión (devuelta incluso en errores, según la doc de Foundry)
  const headerSession = response.headers.get('x-agent-session-id') ?? undefined

  const contentType = response.headers.get('content-type') ?? ''

  if (!response.ok) {
    // Solo aquí se consume el body entero: en caso contrario se leería como stream.
    const raw = await response.text()
    let detail = raw.slice(0, 400)
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string }
      detail = parsed.error?.message ?? parsed.message ?? detail
    } catch {
      /* se queda con el texto crudo */
    }
    throw new Error(`Azure devolvió HTTP ${response.status}: ${detail}`)
  }

  const state: { text: string; responseId?: string; agentSessionId?: string } = {
    text: '',
    agentSessionId: headerSession,
  }

  // Respuesta sin stream (si el servidor ignoró stream:true)
  if (contentType.includes('application/json')) {
    const raw = await response.text()
    let data: Record<string, unknown> | null = null
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    } catch {
      data = null
    }
    if (!data) throw new Error('Respuesta no-JSON del endpoint del agente')
    const failure = apiErrorMessage(data as ResponsesApiEvent)
    if (failure) throw new Error(failure)
    state.text = extractTextFromJson(data)
    const responseData = data.response as { id?: string; agent_session_id?: string } | undefined
    state.responseId = responseData?.id ?? (typeof data.id === 'string' ? data.id : undefined)
    state.agentSessionId = responseData?.agent_session_id ?? state.agentSessionId
    if (state.text) options.onTextDelta?.(state.text)
    emit({ type: 'response_created', at: Date.now(), responseId: state.responseId ?? 'n/d' })
    const durationMs = Math.round(performance.now() - startedAt)
    emit({ type: 'final', at: Date.now(), content: state.text, responseId: state.responseId, durationMs })
    return { ...state, durationMs }
  }

  // Streaming SSE: leer el body línea a línea
  if (!response.body) throw new Error('El endpoint no devolvió un stream legible')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const errorState: { message: string | null } = { message: null }

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payloadRaw = trimmed.slice(5).trim()
    if (!payloadRaw || payloadRaw === '[DONE]') return
    let payload: ResponsesApiEvent
    try {
      payload = JSON.parse(payloadRaw) as ResponsesApiEvent
    } catch {
      return
    }
    const failure = dispatchStreamEvent(payload, state, options)
    if (failure && !errorState.message) errorState.message = failure
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    }
    buffer += decoder.decode()
    if (buffer) handleLine(buffer)
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Petición cancelada')
    throw new Error(`Stream interrumpido: ${errorMessage(error)}`)
  }

  if (errorState.message) throw new Error(errorState.message)

  const durationMs = Math.round(performance.now() - startedAt)
  emit({ type: 'final', at: Date.now(), content: state.text, responseId: state.responseId, durationMs })
  return { ...state, durationMs }
}
