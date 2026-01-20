import fs from 'fs'
import path from 'path'
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb'

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const distDir = path.join(__dirname, 'dist')
const dynamoTable = process.env.DYNAMO_TABLE
const readingsTable = process.env.READINGS_TABLE
const dynamoRegion = process.env.DYNAMO_REGION || process.env.AWS_REGION
const formFieldsRaw = process.env.FORM_FIELDS || '[]'

const fieldDefs = (() => {
    try {
        const parsed = JSON.parse(formFieldsRaw)
        if (!Array.isArray(parsed)) return []
        return parsed
            .filter((f) => f && typeof f.name === 'string' && typeof f.type === 'string')
            .map((f) => ({ name: f.name, type: f.type }))
    } catch (error) {
        console.warn('Failed to parse FORM_FIELDS env; defaulting to empty', error)
        return []
    }
})()

const ddb = new DynamoDBClient({ region: dynamoRegion })

const cache = new Map()
const readFileCached = (filePath) => {
    if (cache.has(filePath)) return cache.get(filePath)
    const data = fs.readFileSync(filePath)
    cache.set(filePath, data)
    return data
}

const injectFieldDefs = (html) => {
    const serialized = JSON.stringify(fieldDefs).replace(/</g, '\\u003c')
    const payload = `window.__FIELD_DEFS__=${serialized};`
    if (html.includes('</head>')) {
        return html.replace('</head>', `<script>${payload}</script></head>`)
    }
    return `<script>${payload}</script>${html}`
}

const contentType = (file) => {
    if (file.endsWith('.html')) return 'text/html; charset=utf-8'
    if (file.endsWith('.js')) return 'application/javascript; charset=utf-8'
    if (file.endsWith('.css')) return 'text/css; charset=utf-8'
    if (file.endsWith('.json')) return 'application/json; charset=utf-8'
    if (file.endsWith('.png')) return 'image/png'
    if (file.endsWith('.svg')) return 'image/svg+xml'
    if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg'
    if (file.endsWith('.ico')) return 'image/x-icon'
    return 'application/octet-stream'
}

const parseCookie = (cookieHeader) => {
    if (!cookieHeader) return {}
    return Object.fromEntries(
        cookieHeader
            .split(';')
            .map((c) => c.trim())
            .filter(Boolean)
            .map((c) => {
                const [k, ...rest] = c.split('=')
                return [decodeURIComponent(k), decodeURIComponent(rest.join('='))]
            }),
    )
}

const corsHeaders = (origin) => ({
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'content-type,x-api-key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
})

const ok = (body, headers = {}, isBase64Encoded = false) => ({
    statusCode: 200,
    headers,
    body,
    isBase64Encoded,
})

const json = (statusCode, data, headers = {}) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
})

const notFound = (headers = {}) => ({ statusCode: 404, headers, body: 'Not found' })

const fetchApiKey = async (key) => {
    if (!key || !dynamoTable) return null
    const command = new GetItemCommand({
        TableName: dynamoTable,
        Key: { api_key: { S: key } },
    })
    const { Item } = await ddb.send(command)
    return Item?.api_key?.S ? Item : null
}

export const handler = async (event) => {
    const method = event?.requestContext?.http?.method || 'GET'
    const rawPath = event?.rawPath || '/'
    const origin = event?.headers?.origin
    const requestHeaders = event?.headers || {}

    const cookieKey = parseCookie(requestHeaders.cookie)?.api_key
    const headerKey = requestHeaders['x-api-key'] || requestHeaders['X-API-Key']
    const queryKey = event?.queryStringParameters?.api_key || new URLSearchParams(event?.rawQueryString || '').get('api_key')
    const suppliedKey = headerKey || queryKey || cookieKey

    let isAuthorized = false
    let authorizedRecord = null
    try {
        const record = await fetchApiKey(suppliedKey)
        authorizedRecord = record
        isAuthorized = Boolean(record)
    } catch (error) {
        console.error('API key lookup failed', error)
        return json(500, { error: 'Internal Server Error' }, corsHeaders(origin))
    }

    if (method === 'OPTIONS') {
        return ok('', corsHeaders(origin))
    }

    if (method === 'GET') {
        if (rawPath === '/config') {
            if (!isAuthorized) {
                return json(401, { error: 'Unauthorized' }, corsHeaders(origin))
            }
            return json(200, { fields: fieldDefs }, corsHeaders(origin))
        }

        if (!isAuthorized) {
            return json(401, { error: 'Unauthorized' }, corsHeaders(origin))
        }

        const requested = rawPath === '/' ? '/index.html' : rawPath
        const safePath = requested.replace(/\.\.+/g, '')
        const target = path.join(distDir, safePath)
        const exists = fs.existsSync(target) && fs.statSync(target).isFile()

        const filePath = exists ? target : path.join(distDir, 'index.html')
        if (!fs.existsSync(filePath)) {
            return notFound(corsHeaders(origin))
        }

        const isHtml = filePath.endsWith('.html')
        const setCookie = (headerKey || queryKey)
            ? `api_key=${encodeURIComponent(headerKey || queryKey)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000`
            : undefined
        const rawData = readFileCached(filePath)
        const bodyBuffer = isHtml ? Buffer.from(injectFieldDefs(rawData.toString('utf-8'))) : rawData

        return ok(bodyBuffer.toString('base64'), {
            ...corsHeaders(origin),
            'Content-Type': contentType(filePath),
            'Cache-Control': isHtml ? 'no-store' : exists ? 'public, max-age=3600' : 'no-cache',
            ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
        }, true)
    }

    if (method === 'POST' && rawPath === '/readings') {
        try {
            if (!isAuthorized) {
                return json(401, { error: 'Unauthorized' }, corsHeaders(origin))
            }

            const payload = event.body ? JSON.parse(event.body) : {}
            const incoming = payload.data && typeof payload.data === 'object' ? payload.data : {}
            const errors = []
            const normalized = {}

            const coerceBoolean = (value) => {
                if (typeof value === 'boolean') return value
                if (typeof value === 'string') {
                    const lower = value.toLowerCase()
                    if (['ok', 'true', 'yes', 'y', '1'].includes(lower)) return true
                    if (['not ok', 'not_ok', 'false', 'no', 'n', '0'].includes(lower)) return false
                }
                return null
            }

            const coerceDurationMinutes = (value) => {
                if (value && typeof value === 'object') {
                    const h = Number(value.hours ?? value.h ?? 0)
                    const m = Number(value.minutes ?? value.m ?? 0)
                    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m
                }
                if (typeof value === 'string') {
                    const match = value.match(/^(\d{1,2}):(\d{1,2})$/)
                    if (match) {
                        const h = Number(match[1])
                        const m = Number(match[2])
                        if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m
                    }
                }
                return null
            }

            for (const def of fieldDefs) {
                const raw = incoming[def.name]
                if (def.type === 'number') {
                    const n = Number(raw)
                    if (Number.isFinite(n)) {
                        normalized[def.name] = n
                    } else {
                        errors.push(`Field ${def.name} must be a number`)
                    }
                } else if (def.type === 'duration') {
                    const durMinutes = coerceDurationMinutes(raw)
                    if (durMinutes !== null) {
                        normalized[def.name] = durMinutes
                    } else {
                        errors.push(`Field ${def.name} must be duration (hours/minutes or HH:MM)`)
                    }
                } else if (def.type === 'boolean') {
                    const b = coerceBoolean(raw)
                    if (b !== null) {
                        normalized[def.name] = b
                    } else {
                        errors.push(`Field ${def.name} must be boolean (ok/not ok)`)
                    }
                } else {
                    errors.push(`Unknown field type ${def.type} for ${def.name}`)
                }
            }

            if (errors.length) {
                return json(400, { error: 'Invalid payload', details: errors }, corsHeaders(origin))
            }

            if (!authorizedRecord?.device_id?.S) {
                return json(500, { error: 'Device mapping unavailable' }, corsHeaders(origin))
            }

            if (!readingsTable) {
                return json(500, { error: 'Readings table not configured' }, corsHeaders(origin))
            }

            const receivedAt = new Date().toISOString()
            const deviceId = authorizedRecord.device_id.S
            const valuesMap = Object.fromEntries(
                Object.entries(normalized).map(([key, value]) => {
                    if (typeof value === 'number') return [key, { N: value.toString() }]
                    return [key, { BOOL: Boolean(value) }]
                }),
            )

            try {
                await ddb.send(new PutItemCommand({
                    TableName: readingsTable,
                    Item: {
                        device_id: { S: deviceId },
                        reading_ts: { S: receivedAt },
                        values: { M: valuesMap },
                    },
                }))
            } catch (error) {
                console.error('Failed to persist reading', error)
                return json(500, { error: 'Could not save reading' }, corsHeaders(origin))
            }

            const setCookie = (headerKey || queryKey)
                ? `api_key=${encodeURIComponent(headerKey || queryKey)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000`
                : undefined

            return json(
                200,
                { ok: true, receivedAt, deviceId, data: normalized },
                {
                    ...corsHeaders(origin),
                    ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
                },
            )
        } catch (error) {
            console.error('API key lookup failed', error)
            return json(500, { error: 'Internal Server Error' }, corsHeaders(origin))
        }
    }

    return notFound(corsHeaders(origin))
}
