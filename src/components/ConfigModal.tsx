import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AgentConfig } from '../services/agentConfig'
import './ConfigModal.css'

interface ConfigModalProps {
  config: AgentConfig
  onSave: (config: AgentConfig) => void
  onClose: () => void
}

/** Se monta solo cuando está abierta: así el estado del formulario se inicializa en cada apertura. */
function ConfigModal({ config, onSave, onClose }: ConfigModalProps) {
  const [endpoint, setEndpoint] = useState(config.endpoint)
  const [apiKey, setApiKey] = useState(config.apiKey)
  const [apiVersion, setApiVersion] = useState(config.apiVersion)
  const [showKey, setShowKey] = useState(false)
  const endpointRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => endpointRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const valid = endpoint.trim().length > 0 && apiKey.trim().length > 0

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid) return
    onSave({
      endpoint: endpoint.trim(),
      apiKey: apiKey.trim(),
      apiVersion: apiVersion.trim() || 'v1',
      model: config.model,
    })
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cfg-title">
        <div className="modal-head">
          <div>
            <h2 id="cfg-title">Configuración de conexión</h2>
            <p>
              Pega aquí los valores de tu agente. La clave caduca cada 2 horas: vuelve a esta
              modal para actualizarla cuando deje de funcionar.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="cfg-endpoint">
              VITE_AZURE_FOUNDRY_AGENT_ENDPOINT
              <span className="field-help">
                URL del agente (Foundry → agente → Test); termina en{' '}
                <code>/endpoint/protocols/openai/responses</code>
              </span>
            </label>
            <input
              id="cfg-endpoint"
              ref={endpointRef}
              type="url"
              spellCheck={false}
              autoComplete="off"
              value={endpoint}
              placeholder="https://mi-recurso.services.ai.azure.com/api/projects/.../responses"
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="cfg-apikey">
              VITE_AZURE_FOUNDRY_API_KEY
              <span className="field-help">
                Clave del recurso (Foundry → Credentials). Si es un JWT se envía como Bearer.
              </span>
            </label>
            <div className="field-inline">
              <input
                id="cfg-apikey"
                type={showKey ? 'text' : 'password'}
                spellCheck={false}
                autoComplete="off"
                value={apiKey}
                placeholder="clave del recurso"
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button type="button" className="btn" onClick={() => setShowKey((value) => !value)}>
                {showKey ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="cfg-apiversion">
              VITE_AZURE_API_VERSION
              <span className="field-help">Query <code>?api-version=</code>; por defecto v1</span>
            </label>
            <input
              id="cfg-apiversion"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={apiVersion}
              placeholder="v1"
              onChange={(event) => setApiVersion(event.target.value)}
            />
          </div>

          {!valid && <p className="modal-error">Endpoint y clave son obligatorios.</p>}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={!valid}>
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ConfigModal
