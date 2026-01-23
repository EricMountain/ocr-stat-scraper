import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type FieldType = 'number' | 'duration' | 'boolean'

type ChartStyle = 'bar' | 'line' | 'point'

type PlotSettings = {
  default?: boolean
  style?: ChartStyle
  unit?: string
}

type FieldDef = {
  name: string
  type: FieldType
  plot?: PlotSettings
}

type Reading = {
  timestamp: string
  values: Record<string, number | boolean>
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

type ChartPoint = {
  ts: Date
  value: number
}

const pad2 = (v: string) => (v.length === 1 ? `0${v}` : v || '00')

const formatNumber = (value: number) => {
  if (Number.isNaN(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude >= 100) return value.toFixed(0)
  if (magnitude >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

const ChartSvg = ({ points, style }: { points: ChartPoint[]; style: ChartStyle }) => {
  if (!points.length) {
    return <div className="chart-empty">No data to plot yet.</div>
  }

  const width = 720
  const height = 280
  const paddingX = 36
  const paddingY = 28
  const innerWidth = width - paddingX * 2
  const innerHeight = height - paddingY * 2

  const values = points.map((p) => p.value)
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    min -= 1
    max += 1
  }

  const xFor = (idx: number) => {
    if (points.length === 1) return paddingX + innerWidth / 2
    return paddingX + (idx / (points.length - 1)) * innerWidth
  }

  const yFor = (value: number) => {
    const ratio = (value - min) / (max - min)
    return paddingY + innerHeight - ratio * innerHeight
  }

  const linePath = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${xFor(idx)},${yFor(p.value)}`).join(' ')
  const gridLines = 5

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Data chart">
      <rect x={0} y={0} width={width} height={height} rx={12} className="chart-surface" />

      {Array.from({ length: gridLines }).map((_, idx) => {
        const y = paddingY + (idx / (gridLines - 1)) * innerHeight
        return <line key={y} x1={paddingX} x2={width - paddingX} y1={y} y2={y} className="chart-grid" />
      })}

      {style === 'bar'
        ? points.map((p, idx) => {
            const barWidth = innerWidth / Math.max(points.length, 6) * 0.7
            const x = xFor(idx) - barWidth / 2
            const y = yFor(p.value)
            const h = paddingY + innerHeight - y
            return <rect key={p.ts.getTime()} x={x} y={y} width={barWidth} height={h} className="chart-bar" />
          })
        : null}

      {style === 'line' && <path d={linePath} className="chart-line" fill="none" />}

      {(style === 'line' || style === 'point') &&
        points.map((p, idx) => (
          <circle key={p.ts.getTime() + idx} cx={xFor(idx)} cy={yFor(p.value)} r={5} className="chart-point" />
        ))}

      <line x1={paddingX} x2={width - paddingX} y1={paddingY + innerHeight} y2={paddingY + innerHeight} className="chart-axis" />
    </svg>
  )
}

function App() {
  const initialFields = typeof window !== 'undefined' && Array.isArray(window.__FIELD_DEFS__) ? window.__FIELD_DEFS__ : []
  const [fields] = useState<FieldDef[]>(initialFields)
  const [numberValues, setNumberValues] = useState<Record<string, string>>({})
  const [durationValues, setDurationValues] = useState<Record<string, DurationValue>>({})
  const [booleanValues, setBooleanValues] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('Configure values and send to backend.')
  const [isSending, setIsSending] = useState(false)
  const [readings, setReadings] = useState<Reading[]>([])
  const [readingsError, setReadingsError] = useState<string | null>(null)
  const [isLoadingReadings, setIsLoadingReadings] = useState(false)
  const [selectedFieldName, setSelectedFieldName] = useState('')
  const [selectedStyle, setSelectedStyle] = useState<ChartStyle>('line')
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({})

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined

  const chartableFields = useMemo(() => fields.filter((f) => f.type === 'number' || f.type === 'duration'), [fields])

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

  useEffect(() => {
    if (!chartableFields.length) {
      setSelectedFieldName('')
      return
    }

    setSelectedFieldName((current) => {
      if (current && chartableFields.some((f) => f.name === current)) return current
      const preferred = chartableFields.find((f) => f.plot?.default) ?? chartableFields[0]
      return preferred?.name ?? ''
    })
  }, [chartableFields])

  useEffect(() => {
    const currentField = chartableFields.find((f) => f.name === selectedFieldName)
    if (!currentField) {
      setSelectedStyle('line')
      return
    }
    const nextStyle = currentField.plot?.style ?? 'line'
    if (nextStyle !== selectedStyle) {
      setSelectedStyle(nextStyle)
    }
  }, [chartableFields, selectedFieldName, selectedStyle])

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

  const fetchReadings = async () => {
    setIsLoadingReadings(true)
    setReadingsError(null)

    try {
      const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
      const endpoint = base ? `${base}/readings` : '/readings'
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `HTTP ${response.status}`)
      }

      const payload = await response.json().catch(() => ({ readings: [] }))
      const rawReadings = Array.isArray(payload.readings) ? payload.readings : []

      const normalized: Reading[] = rawReadings
        .map((entry: unknown) => {
          const record = entry as { timestamp?: unknown; values?: unknown }
          const timestamp = typeof record?.timestamp === 'string' ? record.timestamp : ''
          if (!timestamp) return null
          const valuesRaw = record?.values && typeof record.values === 'object' ? (record.values as Record<string, unknown>) : {}
          const values: Record<string, number | boolean> = {}
          Object.entries(valuesRaw).forEach(([key, value]) => {
            if (typeof value === 'number') values[key] = value
            if (typeof value === 'boolean') values[key] = value
          })
          return { timestamp, values }
        })
        .filter(Boolean) as Reading[]

      normalized.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      setReadings(normalized)
    } catch (error) {
      setReadingsError((error as Error).message)
    } finally {
      setIsLoadingReadings(false)
    }
  }

  useEffect(() => {
    fetchReadings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      fetchReadings().catch(() => null)
    } catch (error) {
      setStatus(`Send failed: ${(error as Error).message}`)
    } finally {
      setIsSending(false)
    }
  }

  const selectedField = chartableFields.find((f) => f.name === selectedFieldName)
  const unitLabel = selectedField?.plot?.unit || (selectedField?.type === 'duration' ? 'minutes' : '')

  const chartPoints = useMemo(() => {
    if (!selectedFieldName) return []
    return readings
      .map((reading) => {
        const raw = reading.values[selectedFieldName]
        if (typeof raw === 'number') return { ts: new Date(reading.timestamp), value: raw }
        if (typeof raw === 'boolean') return { ts: new Date(reading.timestamp), value: raw ? 1 : 0 }
        return null
      })
      .filter((p) => p && !Number.isNaN(p.ts.getTime())) as ChartPoint[]
  }, [readings, selectedFieldName])

  const latestPoint = chartPoints.length ? chartPoints[chartPoints.length - 1] : null
  const latestValueLabel = latestPoint ? `${formatNumber(latestPoint.value)}${unitLabel ? ` ${unitLabel}` : ''}` : '—'
  const latestTimestamp = latestPoint ? latestPoint.ts.toLocaleString() : null

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
        </section>

        <section className="card span-2">
          <div className="card-head">
            <h2>Visualize recent data</h2>
            <p>Plot the stored readings and switch the series you want to see.</p>
          </div>

          {chartableFields.length === 0 ? (
            <p className="hint">Add a number or duration field in form_fields to enable charting.</p>
          ) : (
            <>
              <div className="chart-controls">
                <label className="control chart-control">
                  <span>Data to plot</span>
                  <select value={selectedFieldName} onChange={(e) => setSelectedFieldName(e.target.value)}>
                    {chartableFields.map((field) => (
                      <option key={field.name} value={field.name}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="chart-tags">
                  <span className="pill">Style: {selectedStyle}</span>
                  <span className="pill">Unit: {unitLabel || '—'}</span>
                </div>

                <button onClick={fetchReadings} disabled={isLoadingReadings} aria-live="polite">
                  {isLoadingReadings ? 'Refreshing…' : 'Refresh data'}
                </button>
              </div>

              <div className="chart-shell">
                {readingsError ? (
                  <p className="hint">Failed to load readings: {readingsError}</p>
                ) : isLoadingReadings && !chartPoints.length ? (
                  <p className="hint">Loading readings…</p>
                ) : (
                  <ChartSvg points={chartPoints} style={selectedStyle} />
                )}
              </div>

              <div className="chart-foot">
                <p className="hint">Latest value: {latestValueLabel}</p>
                <p className="hint">Last point: {latestTimestamp || '—'}</p>
                <p className="hint">Showing {chartPoints.length} points</p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default App
