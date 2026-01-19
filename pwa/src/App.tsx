import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createWorker, type Worker } from 'tesseract.js'
import './App.css'

type ParsedReading = {
  voltage?: number
  current?: number
  serial?: string
  timestamp: string
  rawText: string
}

const parseDeviceText = (text: string): ParsedReading => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const normalized = lines.join(' ').toUpperCase()
  const voltageMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(VOLT|V)\b/)
  const currentMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(AMP|A)\b/)
  const serialLine = lines.find((line) => /serial|sn|id/i.test(line))
  const serialMatch = serialLine?.match(/([A-Z0-9\-]{4,})/)

  const toNumber = (value?: string) =>
    value ? parseFloat(value.replace(',', '.')) : undefined

  return {
    voltage: toNumber(voltageMatch?.[1]),
    current: toNumber(currentMatch?.[1]),
    serial: serialMatch?.[1],
    rawText: text.trim(),
    timestamp: new Date().toISOString(),
  }
}

function App() {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [parsed, setParsed] = useState<ParsedReading | null>(null)
  const [status, setStatus] = useState('Add a photo to begin.')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSending, setIsSending] = useState(false)

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
    setParsed(null)
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
      setParsed(parseDeviceText(text))
      setStatus('OCR complete. Review and optionally send.')
    } catch (error) {
      setStatus(`OCR failed: ${(error as Error).message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const sendToBackend = async () => {
    if (!parsed) {
      setStatus('Run OCR before sending.')
      return
    }

    if (!apiBaseUrl) {
      setStatus('Set VITE_API_BASE_URL to enable sending.')
      return
    }

    setIsSending(true)
    setStatus('Sending to backend...')

    try {
      const payload = {
        ...parsed,
        imageName: imageName || 'capture',
        deviceId: parsed.serial ?? 'unknown',
        timestamp: new Date().toISOString(),
      }

      const response = await fetch(
        `${apiBaseUrl.replace(/\/$/, '')}/readings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      setStatus('Payload sent to backend.')
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

  const summary = useMemo(
    () => [
      { label: 'Voltage', value: parsed?.voltage ? `${parsed.voltage} V` : '—' },
      { label: 'Current', value: parsed?.current ? `${parsed.current} A` : '—' },
      { label: 'Serial', value: parsed?.serial ?? '—' },
    ],
    [parsed],
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
              disabled={isSending || !parsed}
            >
              {isSending ? 'Sending…' : 'Send to backend'}
            </button>
          </div>
          <div className="summary">
            {summary.map((item) => (
              <div key={item.label} className="summary-item">
                <p className="summary-label">{item.label}</p>
                <p className="summary-value">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="hint">
            Backend URL: {apiBaseUrl ? apiBaseUrl : 'set VITE_API_BASE_URL'}
          </p>
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
            <h2>Parsed JSON</h2>
            <p>Heuristic extraction; refine regexes as you gather samples.</p>
          </div>
          <pre className="code-block">
            {JSON.stringify(
              parsed ?? {
                voltage: '—',
                current: '—',
                serial: '—',
                rawText: '—',
              },
              null,
              2,
            )}
          </pre>
        </section>
      </div>
    </div>
  )
}

export default App
