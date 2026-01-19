import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createWorker, type Worker } from 'tesseract.js'
import './App.css'

type PatternMatch = {
  pattern: string
  matched: boolean
  error?: string
}

function App() {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [status, setStatus] = useState('Add a photo to begin.')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [scanPatterns, setScanPatterns] = useState<string[]>([])
  const [backendMatches, setBackendMatches] = useState<PatternMatch[]>([])

  const workerRef = useRef<Worker | null>(null)
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined

  const ensureWorker = async () => {
    if (!workerRef.current) {
      workerRef.current = await createWorker('eng')
    }
    return workerRef.current
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (imageUrl) URL.revokeObjectURL(imageUrl)
    const nextUrl = URL.createObjectURL(file)

    setImageUrl(nextUrl)
    setImageName(file.name)
    setOcrText('')
    setBackendMatches([])
    setStatus('Ready to run OCR')
  }

  const runOcr = async () => {
    if (!imageUrl) {
      setStatus('Add a photo first.')
      return
    }

    setIsProcessing(true)
    setStatus('Running OCR...')

    try {
      const worker = await ensureWorker()
      const { data } = await worker.recognize(imageUrl)
      const text = data.text.trim()

      setOcrText(text)
      setBackendMatches([])
      setStatus('OCR complete. Review and optionally send.')
    } catch (error) {
      setStatus(`OCR failed: ${(error as Error).message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const sendToBackend = async () => {
    if (!ocrText) {
      setStatus('Run OCR before sending.')
      return
    }

    setIsSending(true)
    setStatus('Sending to backend...')

    try {
      const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
      const endpoint = base ? `${base}/readings` : '/readings'

      const payload = {
        rawText: ocrText,
        imageName: imageName || 'capture',
        timestamp: new Date().toISOString(),
      }

      const response = await fetch(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const result = await response.json().catch(() => null)
      const serverMatches: PatternMatch[] = Array.isArray(result?.matches)
        ? result.matches
          .filter((m: unknown) => m && typeof (m as any).pattern === 'string')
          .map((m: any) => ({ pattern: m.pattern, matched: Boolean(m.matched) }))
        : []

      setBackendMatches(serverMatches)

      const matchedCount = serverMatches.filter((m) => m.matched).length
      setStatus(`Payload sent. Server matched ${matchedCount} pattern${matchedCount === 1 ? '' : 's'}.`)
    } catch (error) {
      setStatus(`Send failed: ${(error as Error).message}`)
    } finally {
      setIsSending(false)
    }
  }

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    },
    [imageUrl],
  )

  useEffect(
    () => () => {
      if (workerRef.current) workerRef.current.terminate()
    },
    [],
  )

  useEffect(() => {
    const loadPatterns = async () => {
      try {
        const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
        const endpoint = base ? `${base}/config` : '/config'
        const resp = await fetch(endpoint, { credentials: 'include' })
        if (!resp.ok) return
        const json = await resp.json()
        if (Array.isArray(json.scanPatterns)) {
          setScanPatterns(json.scanPatterns)
        }
      } catch {
        // ignore
      }
    }
    loadPatterns()
  }, [apiBaseUrl])

  const localPatternMatches = useMemo<PatternMatch[]>(
    () =>
      scanPatterns.map((pattern) => {
        try {
          const regex = new RegExp(pattern, 'i')
          return { pattern, matched: regex.test(ocrText) }
        } catch (error) {
          return { pattern, matched: false, error: (error as Error).message }
        }
      }),
    [scanPatterns, ocrText],
  )

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">OCR STAT SCRAPER</p>
          <h1>Capture, OCR, parse, ship.</h1>
          <p className="lede">
            Take a photo of the device screen, run on-device OCR with
            Tesseract.js, review parsed values, and post to your Lambda once the
            API URL is configured.
          </p>
          <div className="chips">
            <span className="chip">PWA-ready</span>
            <span className="chip">Client-side OCR</span>
            <span className="chip">Offline-first shell</span>
            <span className="chip">Patterns: {scanPatterns.length}</span>
          </div>
        </div>
        <div className="status-box">
          <p className="status-label">Status</p>
          <p className="status-text">{status}</p>
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <div className="card-head">
            <h2>1. Capture</h2>
            <p>Select or snap a photo of the device screen.</p>
          </div>
          <label className="upload" htmlFor="capture-input">
            <input
              id="capture-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
            />
            <div>
              <p className="upload-title">
                {imageName || 'Tap to choose a photo'}
              </p>
              <p className="upload-hint">
                Uses the rear camera when available.
              </p>
            </div>
          </label>
          {imageUrl ? (
            <div className="preview">
              <img src={imageUrl} alt="Selected capture" />
            </div>
          ) : (
            <div className="preview placeholder">
              <p>No image selected yet.</p>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>2. OCR</h2>
            <p>Run Tesseract.js locally in the browser.</p>
          </div>
          <div className="actions">
            <button
              className="primary"
              onClick={runOcr}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing…' : 'Run OCR'}
            </button>
            <button
              onClick={sendToBackend}
              disabled={isSending || !ocrText}
            >
              {isSending ? 'Sending…' : 'Send to backend'}
            </button>
          </div>
          <p className="hint">Backend URL: {apiBaseUrl ? apiBaseUrl : 'relative /readings (Function URL)'}</p>
        </section>

        <section className="card span-2">
          <div className="card-head">
            <h2>Raw OCR text</h2>
            <p>Inspect what Tesseract read from the image.</p>
          </div>
          <pre className="code-block">{ocrText || 'Waiting for OCR result...'}</pre>
        </section>

        <section className="card span-2">
          <div className="card-head">
            <h2>Scan pattern matches</h2>
            <p>Regex patterns from backend config tested against OCR text.</p>
          </div>
          {scanPatterns.length === 0 ? (
            <p className="hint">No scan patterns returned from /config.</p>
          ) : (
            <ul className="pattern-list">
              {localPatternMatches.map(({ pattern, matched, error }) => (
                <li key={pattern} className={matched ? 'pattern-hit' : 'pattern-miss'}>
                  <span className="pattern-text">{pattern}</span>
                  <span className="pattern-status">
                    {error ? `error: ${error}` : matched ? 'hit' : 'no match'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {backendMatches.length > 0 && (
            <p className="hint">
              Server reported {backendMatches.filter((m) => m.matched).length} match
              {backendMatches.filter((m) => m.matched).length === 1 ? '' : 'es'} on last send.
            </p>
          )}
        </section>

      </div>
    </div>
  )
}

export default App
