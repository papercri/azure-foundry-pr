/**
 * Configuración de conexión con el agente de Azure AI Foundry.
 *
 * Proyecto de formación: NO se usa `.env`. El endpoint va en el código
 * (`DEFAULT_AGENT_CONFIG`); la API key **no se guarda en el repo** y se pega en la
 * modal que aparece en cada carga de página. Lo último que guardó el usuario se
 * conserva en `sessionStorage` para precargar la modal.
 */

export interface AgentConfig {
  endpoint: string
  apiKey: string
  apiVersion: string
  model?: string
}

/** Valores por defecto. La clave se queda vacía a propósito: GitHub bloquea su subida. */
export const DEFAULT_AGENT_CONFIG: Readonly<AgentConfig> = Object.freeze({
  endpoint:
    'https://testttohfoqefho.services.ai.azure.com/api/projects/XVGroup59571-proj/agents/hungry-agent-jt1m1vvj0j/endpoint/protocols/openai/responses',
  apiKey: '',
  apiVersion: 'v1',
})

const STORAGE_KEY = 'foundry.agent-config'

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

export function loadAgentConfig(): AgentConfig {
  const fallback: AgentConfig = { ...DEFAULT_AGENT_CONFIG }

  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(STORAGE_KEY)
  } catch {
    raw = null
  }
  if (!raw) return fallback

  try {
    const stored = JSON.parse(raw) as Record<string, unknown>
    const model = typeof stored.model === 'string' ? stored.model.trim() : ''
    return {
      endpoint: asString(stored.endpoint, fallback.endpoint),
      apiKey: asString(stored.apiKey, fallback.apiKey),
      apiVersion: asString(stored.apiVersion, fallback.apiVersion) || 'v1',
      model: model || undefined,
    }
  } catch {
    return fallback
  }
}

export function saveAgentConfig(config: AgentConfig): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* almacenamiento no disponible (p. ej. modo privado): solo vive en memoria */
  }
}

export function missingConfigFields(config: AgentConfig): string[] {
  const missing: string[] = []
  if (!config.endpoint.trim()) missing.push('VITE_AZURE_FOUNDRY_AGENT_ENDPOINT')
  if (!config.apiKey.trim()) missing.push('VITE_AZURE_FOUNDRY_API_KEY')
  return missing
}
