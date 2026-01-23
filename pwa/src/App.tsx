import * as d3 from 'd3'
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
  const paddingX = 48
  const paddingY = 28
  const innerWidth = width - paddingX * 2

  const [xStartRaw, xEndRaw] = d3.extent<ChartPoint, Date>(points, (p: ChartPoint) => p.ts)
  const xStart = xStartRaw ?? new Date()
  const xEnd = xEndRaw ?? xStart
  const xDomain = xStart.getTime() === xEnd.getTime() ? [xStart, new Date(xStart.getTime() + 60 * 1000)] : [xStart, xEnd]

  const [yMinRaw, yMaxRaw] = d3.extent<ChartPoint, number>(points, (p: ChartPoint) => p.value)
  const yMinBase = yMinRaw ?? 0
  const yMaxBase = yMaxRaw ?? 1
  const yDomain = yMinBase === yMaxBase ? [yMinBase - 1, yMaxBase + 1] : [yMinBase, yMaxBase]

  const xScale = d3.scaleTime().domain(xDomain as [Date, Date]).range([paddingX, width - paddingX])
  const yScale = d3.scaleLinear().domain(yDomain as [number, number]).nice(5).range([height - paddingY, paddingY])

  const xTicks: Date[] = xScale.ticks(5)
  const yTicks: number[] = yScale.ticks(5)
  const formatTime = d3.timeFormat('%m-%d %H:%M')

  const linePath = d3
    .line<ChartPoint>()
    .x((d: ChartPoint) => xScale(d.ts))
    .y((d: ChartPoint) => yScale(d.value))(points)

  const xPositions = points.map((p) => xScale(p.ts)).sort((a, b) => a - b)
  let minGap = innerWidth
  for (let i = 1; i < xPositions.length; i += 1) {
    minGap = Math.min(minGap, xPositions[i] - xPositions[i - 1])
  }
  const barWidth = Math.max(6, Math.min(48, (Number.isFinite(minGap) ? minGap : innerWidth / Math.max(points.length, 1)) * 0.7))

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Data chart">
      <rect x={0} y={0} width={width} height={height} rx={12} className="chart-surface" />

      {yTicks.map((tick: number) => {
        const y = yScale(tick)
        return <line key={`y-${tick}`} x1={paddingX} x2={width - paddingX} y1={y} y2={y} className="chart-grid" />
      })}

      {xTicks.map((tick: Date) => {
        const x = xScale(tick)
        return <line key={`x-${tick.toISOString()}`} x1={x} x2={x} y1={paddingY} y2={height - paddingY} className="chart-grid-vertical" />
      })}

      {style === 'bar' &&
        points.map((p, idx) => {
          const x = xScale(p.ts) - barWidth / 2
          const y = yScale(p.value)
          const h = height - paddingY - y
          return <rect key={p.ts.getTime() + idx} x={x} y={y} width={barWidth} height={h} className="chart-bar" />
        })}

      {style === 'line' && linePath ? <path d={linePath} className="chart-line" fill="none" /> : null}

      {(style === 'line' || style === 'point') &&
        points.map((p, idx) => (
          <circle key={p.ts.getTime() + idx} cx={xScale(p.ts)} cy={yScale(p.value)} r={5} className="chart-point" />
        ))}

      <line x1={paddingX} x2={width - paddingX} y1={height - paddingY} y2={height - paddingY} className="chart-axis" />
      <line x1={paddingX} x2={paddingX} y1={paddingY} y2={height - paddingY} className="chart-axis" />

      {yTicks.map((tick: number) => (
        <text key={`ylabel-${tick}`} x={paddingX - 8} y={yScale(tick) + 4} className="chart-tick" textAnchor="end">
          {formatNumber(tick)}
        </text>
      ))}

      {xTicks.map((tick: Date) => (
        <text key={`xlabel-${tick.toISOString()}`} x={xScale(tick)} y={height - paddingY + 16} className="chart-tick" textAnchor="middle">
          {formatTime(tick)}
        </text>
      ))}
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
