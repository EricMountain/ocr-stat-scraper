import { useEffect, useRef, useState } from 'react'
import './App.css'

type FieldType = 'number' | 'duration' | 'boolean'

type FieldDef = {
  name: string
  type: FieldType
}

declare global {
  interface Window {
    __FIELD_DEFS__?: FieldDef[]
  }
}

type DurationValue = {
  hours: string
  minutes: string
}

const pad2 = (v: string) => (v.length === 1 ? `0${v}` : v || '00')

function App() {
  const initialFields = typeof window !== 'undefined' && Array.isArray(window.__FIELD_DEFS__) ? window.__FIELD_DEFS__ : []
  const [fields] = useState<FieldDef[]>(initialFields)
  const [numberValues, setNumberValues] = useState<Record<string, string>>({})
  const [durationValues, setDurationValues] = useState<Record<string, DurationValue>>({})
  const [booleanValues, setBooleanValues] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('Configure values and send to backend.')
  const [isSending, setIsSending] = useState(false)
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({})

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined

  useEffect(() => {
    if (!fields.length) return
    const nums: Record<string, string> = {}
    const durations: Record<string, DurationValue> = {}
    const bools: Record<string, string> = {}
    fields.forEach((f: FieldDef) => {
      if (f.type === 'number') nums[f.name] = ''
      if (f.type === 'duration') durations[f.name] = { hours: '', minutes: '' }
      if (f.type === 'boolean') bools[f.name] = 'ok'
    })
    setNumberValues(nums)
    setDurationValues(durations)
    setBooleanValues(bools)
  }, [fields])

  const focusNextField = (currentName: string) => {
    const idx = fields.findIndex((f) => f.name === currentName)
    if (idx === -1) return
    for (let i = idx + 1; i < fields.length; i += 1) {
      const next = inputRefs.current[fields[i].name]
      if (next) {
        next.focus()
        return
      }
    }
  }

  const handleEnter = (fieldName: string) => (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      focusNextField(fieldName)
    }
  }

  const buildPayload = () => {
    const data: Record<string, unknown> = {}
    const errors: string[] = []

    fields.forEach((field) => {
      if (field.type === 'number') {
        const raw = numberValues[field.name] ?? ''
        const n = Number(raw)
        if (!Number.isFinite(n)) {
          errors.push(`Enter a number for ${field.name}`)
        } else {
          data[field.name] = n
        }
      } else if (field.type === 'duration') {
        const d = durationValues[field.name] || { hours: '', minutes: '' }
        const h = Number(d.hours || '0')
        const m = Number(d.minutes || '0')
        if (!Number.isFinite(h) || !Number.isFinite(m)) {
          errors.push(`Enter hours and minutes for ${field.name}`)
        } else {
          data[field.name] = { hours: h, minutes: m, totalMinutes: h * 60 + m }
        }
      } else if (field.type === 'boolean') {
        const b = (booleanValues[field.name] || 'ok').toLowerCase() === 'ok'
        data[field.name] = b
      }
    })

    return { data, errors }
  }

  const sendToBackend = async () => {
    if (!fields.length) {
      setStatus('No fields configured. Check /config response or terraform settings.')
      return
    }

    const { data, errors } = buildPayload()
    if (errors.length) {
      setStatus(errors.join(' | '))
      return
    }

    setIsSending(true)
    setStatus('Sending to backend...')

    try {
      const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
      const endpoint = base ? `${base}/readings` : '/readings'

      const payload = {
        data,
        timestamp: new Date().toISOString(),
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text}`)
      }

      const result = await response.json().catch(() => null)
      setStatus(result?.ok ? 'Payload sent.' : 'Payload sent (no ok flag).')
    } catch (error) {
      setStatus(`Send failed: ${(error as Error).message}`)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="page">
      <div className="grid">
        <section className="card span-2">
          <div className="card-head">
            <h2>Enter values and submit</h2>
          </div>
          {fields.length === 0 ? (
            <p className="hint">No fields returned from /config.</p>
          ) : (
            <div className="form-grid">
              {fields.map((field) => {
                if (field.type === 'number') {
                  return (
                    <label className="control" key={field.name}>
                      <span>{field.name}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={numberValues[field.name] ?? ''}
                        ref={(el) => {
                          inputRefs.current[field.name] = el
                        }}
                        onKeyDown={handleEnter(field.name)}
                        onChange={(e) => setNumberValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                  )
                }

                if (field.type === 'duration') {
                  const current = durationValues[field.name] || { hours: '', minutes: '' }
                  const timeValue = `${pad2(current.hours)}:${pad2(current.minutes)}`
                  return (
                    <div className="control" key={field.name}>
                      <span>{field.name} (HH:MM)</span>
                      <input
                        type="time"
                        inputMode="numeric"
                        value={timeValue}
                        ref={(el) => {
                          inputRefs.current[field.name] = el
                        }}
                        onKeyDown={handleEnter(field.name)}
                        onChange={(e) => {
                          const [h = '0', m = '0'] = (e.target.value || '0:0').split(':')
                          setDurationValues((prev) => ({
                            ...prev,
                            [field.name]: { hours: h, minutes: m },
                          }))
                        }}
                        step={300}
                      />
                    </div>
                  )
                }

                if (field.type === 'boolean') {
                  return (
                    <label className="control" key={field.name}>
                      <span>{field.name}</span>
                      <select
                        value={booleanValues[field.name] ?? 'ok'}
                        ref={(el) => {
                          inputRefs.current[field.name] = el
                        }}
                        onKeyDown={handleEnter(field.name)}
                        onChange={(e) => setBooleanValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                      >
                        <option value="ok">ok</option>
                        <option value="not ok">not ok</option>
                      </select>
                    </label>
                  )
                }

                return (
                  <p className="hint" key={field.name}>
                    Unsupported field type: {field.type}
                  </p>
                )
              })}
            </div>
          )}

          <div className="actions">
            <button className="primary" onClick={sendToBackend} disabled={isSending || fields.length === 0}>
              {isSending ? 'Sending…' : 'Send to backend'}
            </button>
            <div className="status-box">
              <p className="status-label">Status</p>
              <p className="status-text">{status}</p>
            </div>
          </div>
          <p className="hint">Backend URL: {apiBaseUrl ? apiBaseUrl : 'relative /readings (Function URL)'}</p>
        </section>
      </div>
    </div>
  )
}

export default App
