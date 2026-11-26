import { useEffect, useRef, useState } from 'react'
import { streamAgentReply, type PlaygroundEvent } from '../services/foundryService'
import {
  loadAgentConfig,
  missingConfigFields,
  saveAgentConfig,
  type AgentConfig,
} from '../services/agentConfig'
import ConfigModal from './ConfigModal'
import { applyTheme, readStoredTheme, type Theme } from '../theme'
import {
  readPayloadFormat,
  savePayloadFormat,
  toYaml,
  type PayloadFormat,
} from '../yaml'
import './FoundryPlayground.css'

const SUGGESTIONS = [
  'Hola, ¿qué puedes hacer?',
  'Lista las herramientas de las que dispones',
  'Resume en 3 puntos cómo funciona este agente',
]

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function formatPayload(payload: unknown, format: PayloadFormat): string {
  if (format === 'yaml') return toYaml(payload)
  return prettyJson(JSON.stringify(payload, null, 2))
}

function formatTime(at: number): string {
  const date = new Date(at)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function agentNameFromEndpoint(endpoint: string): string {
  return /\/agents\/([^/]+)/.exec(endpoint)?.[1] ?? '—'
}

function FoundryPlayground() {
  const [config, setConfig] = useState<AgentConfig>(() => loadAgentConfig())
  const [configOpen, setConfigOpen] = useState(true)
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme())

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [events, setEvents] = useState<PlaygroundEvent[]>([])
  const [payloadFormat, setPayloadFormat] = useState<PayloadFormat>(() => readPayloadFormat())
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const [agentSessionId, setAgentSessionId] = useState<string | undefined>(undefined)
  const [previousResponseId, setPreviousResponseId] = useState<string | undefined>(undefined)
  const [turn, setTurn] = useState(0)

  const chatBodyRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const missing = missingConfigFields(config)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const element = chatBodyRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, streamingText, busy])

  const canSend = !busy && input.trim().length > 0 && missing.length === 0 && !configOpen

  const pushEvent = (event: PlaygroundEvent) => setEvents((previous) => [...previous, event])

  async function handleSend(text?: string) {
    const content = (text ?? input).trim()
    if (!content || !canSend) return

    setInput('')
    setBusy(true)
    setStreamingText('')
    setMessages((previous) => [...previous, { role: 'user', content }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await streamAgentReply({
        input: content,
        round: turn + 1,
        agentSessionId,
        previousResponseId,
        signal: controller.signal,
        onEvent: pushEvent,
        onTextDelta: (delta) => setStreamingText((previous) => (previous ?? '') + delta),
      })
      setMessages((previous) => [...previous, { role: 'assistant', content: result.text }])
      if (result.agentSessionId) setAgentSessionId(result.agentSessionId)
      if (result.responseId) setPreviousResponseId(result.responseId)
      setTurn((previous) => previous + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMessages((previous) => [...previous, { role: 'assistant', content: `Error: ${message}` }])
      pushEvent({ type: 'error', at: Date.now(), message })
    } finally {
      setStreamingText(null)
      setBusy(false)
      abortRef.current = null
    }
  }

  function handleCancel() {
    abortRef.current?.abort()
  }

  function resetConversation() {
    if (busy) return
    setMessages([])
    setEvents([])
    setAgentSessionId(undefined)
    setPreviousResponseId(undefined)
    setTurn(0)
  }

  function handleSaveConfig(next: AgentConfig) {
    abortRef.current?.abort()
    saveAgentConfig(next)
    setConfig(next)
    setConfigOpen(false)
    setAgentSessionId(undefined)
    setPreviousResponseId(undefined)
    setTurn(0)
  }

  return (
    <div className="playground">
      <header className="pg-header">
        <div>
          <h1>Azure AI Foundry · Agent Playground</h1>
          <p className="pg-sub">
            Conversa con tu agente por el protocolo <code>openai/responses</code> con streaming en vivo y
            traza de actividad.
          </p>
        </div>
        <div className="pg-chips">
          <button
            type="button"
            className="btn"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            title={`Cambiar a modo ${theme === 'dark' ? 'claro' : 'oscuro'}`}
          >
            {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          </button>
          <button type="button" className="btn" onClick={() => setConfigOpen(true)}>
            Configuración
          </button>
          <span className="chip" title={config.endpoint}>
            agente: {agentNameFromEndpoint(config.endpoint)}
          </span>
          <span className="chip">api-version: {config.apiVersion || '—'}</span>
          {agentSessionId && (
            <span className="chip" title={agentSessionId}>
              sesión: {agentSessionId.slice(0, 12)}…
            </span>
          )}
        </div>
      </header>

      {missing.length > 0 && !configOpen && (
        <div className="pg-banner" role="alert">
          Faltan datos de conexión: {missing.join(', ')}. Pulsa en{' '}
          <button type="button" className="link-btn" onClick={() => setConfigOpen(true)}>
            Configuración
          </button>{' '}
          para completarlos.
        </div>
      )}

      <div className="pg-grid">
        <section className="panel panel-chat" aria-label="Chat con el agente">
          <div className="panel-head">
            <h2>Chat</h2>
            <div className="panel-actions">
              {busy && (
                <button type="button" className="btn" onClick={handleCancel}>
                  Cancelar
                </button>
              )}
              <button type="button" className="btn" onClick={resetConversation} disabled={busy}>
                Nueva conversación
              </button>
            </div>
          </div>
          <div className="panel-body chat-body" ref={chatBodyRef}>
            {messages.length === 0 && streamingText === null && !busy && (
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
            {messages.map((message, index) => (
              <div className={`msg msg-${message.role}`} key={`msg-${index}`}>
                <span className="msg-role">{message.role}</span>
                {message.content}
              </div>
            ))}
            {streamingText !== null && (
              <div className="msg msg-assistant">
                <span className="msg-role">assistant</span>
                {streamingText === '' ? (
                  <span className="typing">El agente está trabajando…</span>
                ) : (
                  streamingText
                )}
              </div>
            )}
            {busy && streamingText === null && (
              <div className="typing">Conectando con el agente…</div>
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
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSend()}
              disabled={!canSend}
            >
              {busy ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </section>

        <section className="panel" aria-label="Actividad del agente">
          <div className="panel-head">
            <h2>Actividad</h2>
            <div className="panel-actions">
              <button
                type="button"
                className="btn"
                aria-pressed={payloadFormat === 'yaml'}
                title="Alternar el formato de los payloads entre JSON y YAML"
                onClick={() => {
                  const next: PayloadFormat = payloadFormat === 'json' ? 'yaml' : 'json'
                  setPayloadFormat(next)
                  savePayloadFormat(next)
                }}
              >
                {payloadFormat}
              </button>
              <button type="button" className="btn" onClick={() => setEvents([])} disabled={busy}>
                Limpiar
              </button>
            </div>
          </div>
          <div className="panel-body inspector-body">
            {events.length === 0 && (
              <p className="inspector-empty">
                Sin actividad todavía. Aquí verás cada petición, la respuesta del agente, sus llamadas a
                herramientas y la respuesta final.
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
                      {event.previousResponseId
                        ? `previous_response_id: ${event.previousResponseId}`
                        : 'primera respuesta (sin historial)'}
                      {event.sessionId ? ` · sesión: ${event.sessionId}` : ''}
                    </p>
                    <p className="event-label">input</p>
                    <pre>{event.input}</pre>
                  </article>
                )
              }
              if (event.type === 'response_created') {
                return (
                  <article className="event" key={key}>
                    <div className="event-head">
                      <span className="badge badge-request">response.created</span>
                      <time>{formatTime(event.at)}</time>
                    </div>
                    <p className="event-text">id: {event.responseId}</p>
                  </article>
                )
              }
              if (event.type === 'output_item') {
                const isCall = event.kind === 'function_call'
                return (
                  <article className="event" key={key}>
                    <div className="event-head">
                      <span className={`badge ${isCall ? 'badge-calls' : 'badge-result'}`}>
                        {isCall ? `tool · ${event.name ?? 'función'}` : event.kind}
                      </span>
                      <time>{formatTime(event.at)}</time>
                    </div>
                    <pre>{formatPayload(event.payload, payloadFormat)}</pre>
                  </article>
                )
              }
              if (event.type === 'final') {
                return (
                  <article className="event" key={key}>
                    <div className="event-head">
                      <span className="badge badge-final">final · {event.durationMs}ms</span>
                      <time>{formatTime(event.at)}</time>
                    </div>
                    <p className="event-text">
                      {event.responseId ? `id: ${event.responseId}` : 'sin id de respuesta'}
                    </p>
                    {event.content && <p className="event-text">{event.content}</p>}
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
      <p className="pg-footnote">
        turno actual: {turn}
        {previousResponseId ? ` · previous_response_id: ${previousResponseId}` : ''}
      </p>

      {configOpen && (
        <ConfigModal config={config} onSave={handleSaveConfig} onClose={() => setConfigOpen(false)} />
      )}
    </div>
  )
}

export default FoundryPlayground
