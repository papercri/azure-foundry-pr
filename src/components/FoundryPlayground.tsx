import { useEffect, useMemo, useRef, useState } from 'react'
import {
  chatWithTools,
  readFoundryConfig,
  type ChatMessage,
  type PlaygroundEvent,
  type ToolDefinition,
} from '../services/foundryService'
import { DEFAULT_TOOLS_JSON, executeTool } from '../services/mockTools'
import './FoundryPlayground.css'

const SYSTEM_PROMPT =
  'Eres un asistente útil con acceso a herramientas. Usa las tools disponibles cuando ayuden a responder con precisión.'

const SUGGESTIONS = [
  '¿Cuál es el estado del pedido A-1024?',
  '¿Qué tiempo hace en Madrid en celsius?',
  '¿Qué hora es ahora en Europe/Madrid?',
]

function createInitialMessages(): ChatMessage[] {
  return [{ role: 'system', content: SYSTEM_PROMPT }]
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function formatTime(at: number): string {
  const date = new Date(at)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

interface ParsedTools {
  tools: ToolDefinition[]
  error: string | null
}

function parseTools(raw: string): ParsedTools {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('El editor debe contener un array de tools: [ ... ]')
    parsed.forEach((tool, index) => {
      const candidate = tool as ToolDefinition | null
      if (candidate?.type !== 'function' || !candidate.function?.name) {
        throw new Error(`La entrada [${index}] debe ser { type: "function", function: { name, parameters } }`)
      }
      if (typeof candidate.function.parameters !== 'object' || candidate.function.parameters === null) {
        throw new Error(`La tool "${candidate.function.name}" necesita "parameters" (JSON Schema)`)
      }
    })
    return { tools: parsed as ToolDefinition[], error: null }
  } catch (error) {
    return { tools: [], error: error instanceof Error ? error.message : String(error) }
  }
}

function FoundryPlayground() {
  const { config, missing } = useMemo(() => readFoundryConfig(), [])

  const [toolsJson, setToolsJson] = useState(DEFAULT_TOOLS_JSON)
  const parsedTools = useMemo(() => parseTools(toolsJson), [toolsJson])

  const [messages, setMessages] = useState<ChatMessage[]>(createInitialMessages)
  const [events, setEvents] = useState<PlaygroundEvent[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const chatBodyRef = useRef<HTMLDivElement>(null)

  const toolNamesById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const message of messages) {
      for (const call of message.tool_calls ?? []) {
        map[call.id] = call.function.name
      }
    }
    return map
  }, [messages])

  useEffect(() => {
    const element = chatBodyRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, busy])

  const canSend =
    !busy && input.trim().length > 0 && parsedTools.error === null && missing.length === 0

  async function handleSend(text?: string) {
    const content = (text ?? input).trim()
    if (!content || !canSend) return

    setInput('')
    setBusy(true)

    const history: ChatMessage[] = [...messages, { role: 'user', content }]
    setMessages(history)

    try {
      const result = await chatWithTools({
        messages: history,
        tools: parsedTools.tools,
        executeTool,
        onEvent: (event) => setEvents((previous) => [...previous, event]),
      })
      setMessages(result.messages)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMessages([...history, { role: 'assistant', content: `Error: ${message}` }])
      setEvents((previous) => [...previous, { type: 'error', at: Date.now(), message }])
    } finally {
      setBusy(false)
    }
  }

  function resetConversation() {
    if (busy) return
    setMessages(createInitialMessages())
    setEvents([])
  }

  return (
    <div className="playground">
      <header className="pg-header">
        <div>
          <h1>Azure AI Foundry · Tool Calling Playground</h1>
          <p className="pg-sub">
            Editor de tools JSON Schema, chat y inspector de <code>tool_calls</code> en vivo.
          </p>
        </div>
        <div className="pg-chips">
          <span className="chip">deployment: {config.deployment || '—'}</span>
          <span className="chip">api-version: {config.apiVersion || '—'}</span>
        </div>
      </header>

      {missing.length > 0 && (
        <div className="pg-banner" role="alert">
          Faltan variables en <code>.env</code>: {missing.join(', ')} — complétalas en <code>.env</code>{' '}
          (hay una plantilla en <code>.env.example</code>).
        </div>
      )}

      <div className="pg-grid">
        <section className="panel" aria-label="Editor de tools">
          <div className="panel-head">
            <h2>Tools (JSON Schema)</h2>
            <button
              type="button"
              className="btn"
              onClick={() => setToolsJson(DEFAULT_TOOLS_JSON)}
              disabled={busy}
            >
              Restaurar
            </button>
          </div>
          <div className="panel-body editor-body">
            <textarea
              className="tools-editor"
              value={toolsJson}
              spellCheck={false}
              aria-label="Definición JSON de las tools"
              onChange={(event) => setToolsJson(event.target.value)}
            />
            <p className={`editor-status ${parsedTools.error ? 'err' : 'ok'}`}>
              {parsedTools.error
                ? parsedTools.error
                : `JSON válido · ${parsedTools.tools.length} tool(s): ${
                    parsedTools.tools.map((tool) => tool.function.name).join(', ') || 'ninguna'
                  }`}
            </p>
          </div>
        </section>

        <section className="panel" aria-label="Chat de pruebas">
          <div className="panel-head">
            <h2>Chat</h2>
            <button type="button" className="btn" onClick={resetConversation} disabled={busy}>
              Nueva conversación
            </button>
          </div>
          <div className="panel-body chat-body" ref={chatBodyRef}>
            {messages.map((message, index) => {
              if (message.role === 'tool') {
                return (
                  <div className="msg msg-tool" key={`msg-${index}`}>
                    <span className="msg-role">tool · {toolNamesById[message.tool_call_id ?? ''] ?? 'desconocida'}</span>
                    {message.content}
                  </div>
                )
              }
              if (message.role === 'system') {
                return (
                  <div className="msg msg-system" key={`msg-${index}`}>
                    system · {message.content}
                  </div>
                )
              }
              return (
                <div className={`msg msg-${message.role}`} key={`msg-${index}`}>
                  <span className="msg-role">{message.role}</span>
                  {message.content}
                </div>
              )
            })}
            {busy && <div className="typing">El modelo está decidiendo si llama tools…</div>}
            {!busy && messages.length <= 1 && (
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    className="btn suggestion"
                    onClick={() => void handleSend(suggestion)}
                    disabled={!canSend}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="chat-input">
            <textarea
              value={input}
              placeholder="Escribe un prompt… (Enter para enviar, Shift+Enter salto de línea)"
              aria-label="Prompt"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => void handleSend()} disabled={!canSend}>
              {busy ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </section>

        <section className="panel" aria-label="Inspector de tool calls">
          <div className="panel-head">
            <h2>Inspector</h2>
            <button type="button" className="btn" onClick={() => setEvents([])} disabled={busy}>
              Limpiar
            </button>
          </div>
          <div className="panel-body inspector-body">
            {events.length === 0 && (
              <p className="inspector-empty">
                Sin actividad todavía. Aquí verás cada <code>tool_calls</code>, sus argumentos y el retorno de cada
                función.
              </p>
            )}
            {events.map((event, index) => {
              const key = `event-${index}`
              if (event.type === 'request') {
                return (
                  <article className="event" key={key}>
                    <div className="event-head">
                      <span className="badge badge-request">request #{event.round}</span>
                      <time>{formatTime(event.at)}</time>
                    </div>
                    <p className="event-text">
                      {event.messageCount} mensaje(s) · {event.toolCount} tool(s) enviadas
                    </p>
                  </article>
                )
              }
              if (event.type === 'tool_calls') {
                return (
                  <article className="event" key={key}>
                    <div className="event-head">
                      <span className="badge badge-calls">tool_calls ×{event.toolCalls.length}</span>
                      <time>{formatTime(event.at)}</time>
                    </div>
                    <pre>{prettyJson(JSON.stringify(event.toolCalls, null, 2))}</pre>
                  </article>
                )
              }
              if (event.type === 'tool_result') {
                return (
                  <article className={`event ${event.error ? 'event-error' : ''}`} key={key}>
                    <div className="event-head">
                      <span className="badge badge-result">
                        {event.name} · {event.durationMs}ms
                      </span>
                      <time>{formatTime(event.at)}</time>
                    </div>
                    <p className="event-label">argumentos del modelo</p>
                    <pre>{prettyJson(event.arguments)}</pre>
                    <p className="event-label">{event.error ? 'error de la función' : 'retorno de la función'}</p>
                    <pre>{prettyJson(event.result)}</pre>
                  </article>
                )
              }
              if (event.type === 'final') {
                return (
                  <article className="event" key={key}>
                    <div className="event-head">
                      <span className="badge badge-final">respuesta final</span>
                      <time>{formatTime(event.at)}</time>
                    </div>
                    <p className="event-text">{event.content}</p>
                  </article>
                )
              }
              return (
                <article className="event event-error" key={key}>
                  <div className="event-head">
                    <span className="badge badge-error">error</span>
                    <time>{formatTime(event.at)}</time>
                  </div>
                  <p className="event-text">{event.message}</p>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

export default FoundryPlayground
