/**
 * Tools locales de ejemplo (mock) para probar el ciclo de function calling
 * contra Azure AI Foundry. Incluye los esquemas JSON y los ejecutadores.
 */

import type { ToolDefinition } from './foundryService'

type JsonObject = Record<string, unknown>

function asObject(argsJson: string): JsonObject {
  const parsed: unknown = JSON.parse(argsJson || '{}')
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Los argumentos de la tool deben ser un objeto JSON')
  }
  return parsed as JsonObject
}

function requireString(args: JsonObject, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`El argumento "${key}" es obligatorio y debe ser un string`)
  }
  return value.trim()
}

// ---------------------------------------------------------------------------
// 1. Estado de un pedido
// ---------------------------------------------------------------------------

interface MockOrder {
  orderId: string
  status: 'processing' | 'in_transit' | 'delivered' | 'cancelled'
  carrier: string
  eta: string
  destination: string
}

const MOCK_ORDERS: Record<string, MockOrder> = {
  'A-1024': {
    orderId: 'A-1024',
    status: 'in_transit',
    carrier: 'DHL Express',
    eta: '2026-11-18',
    destination: 'Madrid, ES',
  },
  'B-7781': {
    orderId: 'B-7781',
    status: 'delivered',
    carrier: 'SEUR',
    eta: '2026-11-12',
    destination: 'Barcelona, ES',
  },
  'C-3390': {
    orderId: 'C-3390',
    status: 'processing',
    carrier: 'Correos Express',
    eta: '2026-11-22',
    destination: 'Sevilla, ES',
  },
}

async function getOrderStatus(argsJson: string): Promise<unknown> {
  const args = asObject(argsJson)
  const orderId = requireString(args, 'orderId').toUpperCase()
  const order = MOCK_ORDERS[orderId]
  if (!order) {
    return {
      found: false,
      orderId,
      hint: `Prueba con: ${Object.keys(MOCK_ORDERS).join(', ')}`,
    }
  }
  return { found: true, ...order }
}

// ---------------------------------------------------------------------------
// 2. Estado del tiempo (mock determinístico por ciudad)
// ---------------------------------------------------------------------------

const WEATHER_CONDITIONS = ['soleado', 'nublado', 'lluvia', 'tormenta', 'niebla', 'viento']

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

async function getWeather(argsJson: string): Promise<unknown> {
  const args = asObject(argsJson)
  const city = requireString(args, 'city')
  const unit = args.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius'

  const hash = hashString(city.toLowerCase())
  const condition = WEATHER_CONDITIONS[hash % WEATHER_CONDITIONS.length]
  const baseCelsius = 5 + (hash % 26)
  const temperature =
    unit === 'fahrenheit' ? Math.round((baseCelsius * 9) / 5 + 32) : baseCelsius

  return {
    city,
    condition,
    temperature,
    unit,
    source: 'mock',
    updatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// 3. Hora actual por zona horaria (función real, no mock)
// ---------------------------------------------------------------------------

async function getCurrentTime(argsJson: string): Promise<unknown> {
  const args = asObject(argsJson)
  const timezone = typeof args.timezone === 'string' && args.timezone.trim() ? args.timezone.trim() : 'UTC'
  const now = new Date()
  const formatted = new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'full',
    timeStyle: 'long',
    timeZone: timezone,
  }).format(now)
  return { timezone, now: now.toISOString(), local: formatted }
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

const executors: Record<string, (argsJson: string) => Promise<unknown>> = {
  get_order_status: getOrderStatus,
  get_weather: getWeather,
  get_current_time: getCurrentTime,
}

export const DEFAULT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_order_status',
      description: 'Consulta el estado de envío de un pedido por su identificador.',
      parameters: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            description: 'Identificador del pedido, p. ej. "A-1024".',
          },
        },
        required: ['orderId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Devuelve el tiempo actual (mock) de una ciudad.',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'Nombre de la ciudad, p. ej. "Madrid".',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Unidad de temperatura. Por defecto celsius.',
          },
        },
        required: ['city'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Devuelve la fecha y hora actuales de una zona horaria IANA.',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Zona horaria IANA, p. ej. "Europe/Madrid". Por defecto "UTC".',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
]

/** Ejecuta la tool local correspondiente a un tool_call del modelo. */
export async function executeTool(name: string, argsJson: string): Promise<unknown> {
  const executor = executors[name]
  if (!executor) {
    throw new Error(`Tool desconocida: "${name}". Disponibles: ${Object.keys(executors).join(', ')}`)
  }
  return executor(argsJson)
}

export const DEFAULT_TOOLS_JSON: string = JSON.stringify(DEFAULT_TOOLS, null, 2)
