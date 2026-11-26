/**
 * Serializador JSON → YAML propio (sin dependencias) para mostrar los payloads
 * del panel Actividad en YAML. Es solo para visualización: cubre los tipos que
 * devuelve la API `responses` (objetos, arrays, strings, números, booleanos, null).
 *
 * Además, un string que contiene JSON (p. ej. `function_call.arguments`) se
 * parsea y se anida como bloque, para que los argumentos se lean como YAML real.
 */

export type PayloadFormat = 'json' | 'yaml'

const KEY_SAFE = /^[A-Za-z_][\w.-]*$/
const LOOKS_LIKE_JSON = /^\s*[[{]/

const FORMAT_KEY = 'foundry.payload-format'

function tryParseJson(raw: string): unknown | undefined {
  if (!LOOKS_LIKE_JSON.test(raw)) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function quoteString(raw: string): string {
  if (raw === '') return "''"
  const needsQuote =
    raw !== raw.trim() ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(raw) ||
    /:\s/.test(raw) ||
    /\s#/.test(raw) ||
    /[\n\t\r]/.test(raw) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(raw) ||
    /^-?(\d+(\.\d+)?|\.\d+)$/.test(raw)
  return needsQuote ? JSON.stringify(raw) : raw
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') return quoteString(value)
  return 'null'
}

function emit(value: unknown, depth: number): string[] {
  const pad = '  '.repeat(depth)

  if (typeof value === 'string') {
    const nested = tryParseJson(value)
    if (nested) return emit(nested, depth)
    return [pad + scalar(value)]
  }

  if (value === null || typeof value !== 'object') return [pad + scalar(value)]

  if (Array.isArray(value)) {
    if (value.length === 0) return [pad + '[]']
    return value.flatMap((item) => {
      const isBlock = (item !== null && typeof item === 'object') || typeof item === 'string'
      if (isBlock) {
        const inner = emit(item, depth + 1)
        const [first = '', ...rest] = inner
        return [pad + '- ' + first.slice(pad.length + 2), ...rest]
      }
      return [pad + '- ' + scalar(item)]
    })
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return [pad + '{}']

  return entries.flatMap(([key, child]) => {
    const name = KEY_SAFE.test(key) ? key : JSON.stringify(key)
    const isEmptyBlock =
      child !== null && typeof child === 'object' && Object.keys(child as object).length === 0
    if (isEmptyBlock) {
      return [`${pad}${name}: ${Array.isArray(child) ? '[]' : '{}'}`]
    }
    if (child !== null && typeof child === 'object') {
      return [`${pad}${name}:`, ...emit(child, depth + 1)]
    }
    if (typeof child === 'string' && tryParseJson(child)) {
      return [`${pad}${name}:`, ...emit(child, depth + 1)]
    }
    return [`${pad}${name}: ${scalar(child)}`]
  })
}

/** Convierte cualquier valor (payload de la API) a una cadena YAML. */
export function toYaml(value: unknown): string {
  return emit(value, 0).join('\n')
}

export function readPayloadFormat(): PayloadFormat {
  try {
    return sessionStorage.getItem(FORMAT_KEY) === 'yaml' ? 'yaml' : 'json'
  } catch {
    return 'json'
  }
}

export function savePayloadFormat(format: PayloadFormat): void {
  try {
    sessionStorage.setItem(FORMAT_KEY, format)
  } catch {
    /* almacenamiento no disponible: solo vive en memoria */
  }
}
