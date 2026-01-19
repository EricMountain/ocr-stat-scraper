import fs from 'fs'
import path from 'path'
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const distDir = path.join(__dirname, 'dist')
const dynamoTable = process.env.DYNAMO_TABLE
const dynamoRegion = process.env.DYNAMO_REGION || process.env.AWS_REGION
const scanPatternsRaw = process.env.SCAN_PATTERNS || '[]'

const patternStrings = (() => {
    try {
        const parsed = JSON.parse(scanPatternsRaw)
        return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []
    } catch (error) {
        console.warn('Failed to parse SCAN_PATTERNS env; defaulting to empty', error)
        return []
    }
})()

const patternRegexes = patternStrings.map((p) => {
    try {
        return new RegExp(p, 'i')
    } catch (error) {
        console.warn('Invalid regex pattern skipped:', p, error)
        return null
    }
}).filter(Boolean)

const ddb = new DynamoDBClient({ region: dynamoRegion })

const cache = new Map()
const readFileCached = (filePath) => {
    if (cache.has(filePath)) return cache.get(filePath)
    const data = fs.readFileSync(filePath)
    cache.set(filePath, data)
    return data
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
    try {
        const record = await fetchApiKey(suppliedKey)
        isAuthorized = Boolean(record)
    } catch (error) {
        console.error('API key lookup failed', error)
        return json(500, { error: 'Internal Server Error' }, corsHeaders(origin))
    }

    if (method === 'OPTIONS') {
        return ok('', corsHeaders(origin))
    }

    if (method === 'GET') {
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

        const data = readFileCached(filePath)
        const isHtml = filePath.endsWith('.html')
        const setCookie = (headerKey || queryKey)
            ? `api_key=${encodeURIComponent(headerKey || queryKey)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000`
            : undefined

        return ok(data.toString('base64'), {
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

            const text =
                typeof payload.rawText === 'string'
                    ? payload.rawText
                    : typeof payload.text === 'string'
                        ? payload.text
                        : JSON.stringify(payload)

            const matches = patternRegexes
                .map((regex, idx) => ({ pattern: patternStrings[idx], matched: regex.test(text) }))
                .filter((m) => m.matched)

            // Placeholder for your processing logic (store, forward, etc.)
            const setCookie = (headerKey || queryKey)
                ? `api_key=${encodeURIComponent(headerKey || queryKey)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000`
                : undefined

            return json(
                200,
                { ok: true, receivedAt: new Date().toISOString(), matches },
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
