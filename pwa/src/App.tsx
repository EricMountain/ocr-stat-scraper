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

type Series = {
  field: FieldDef
  points: ChartPoint[]
  color: string
  style: ChartStyle
  unit?: string
  side: 'left' | 'right'
}

const pad2 = (v: string) => (v.length === 1 ? `0${v}` : v || '00')

const formatNumber = (value: number) => {
  if (Number.isNaN(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude >= 100) return value.toFixed(0)
  if (magnitude >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

const ChartSvg = ({ series }: { series: Series[] }) => {
  const plotted = series.slice(0, 2)
  if (!plotted.length || plotted.every((s) => s.points.length === 0)) {
    return <div className="chart-empty">No data to plot yet.</div>
  }

  const width = 720
  const height = 280
  const paddingX = 48
  const paddingY = 28
  const innerWidth = width - paddingX * 2

  const allPoints = plotted.flatMap((s) => s.points)
  const [xStartRaw, xEndRaw] = d3.extent<ChartPoint, Date>(allPoints, (p: ChartPoint) => p.ts)
  const xStart = xStartRaw ?? new Date()
  const xEnd = xEndRaw ?? xStart
  const xDomain = xStart.getTime() === xEnd.getTime() ? [xStart, new Date(xStart.getTime() + 60 * 1000)] : [xStart, xEnd]

  const xScale = d3.scaleTime().domain(xDomain as [Date, Date]).range([paddingX, width - paddingX])

  const buildYScale = (pts: ChartPoint[]) => {
    const [minRaw, maxRaw] = d3.extent<ChartPoint, number>(pts, (p: ChartPoint) => p.value)
    const minBase = minRaw ?? 0
    const maxBase = maxRaw ?? 1
    const domain = minBase === maxBase ? [minBase - 1, maxBase + 1] : [minBase, maxBase]
    return d3.scaleLinear().domain(domain as [number, number]).nice(5).range([height - paddingY, paddingY])
  }

  const leftSeries = plotted[0]
  const rightSeries = plotted[1]
  const leftScale = leftSeries ? buildYScale(leftSeries.points) : null
  const rightScale = rightSeries ? buildYScale(rightSeries.points) : null

  const xTicks: Date[] = xScale.ticks(5)
  const yTicksLeft: number[] = leftScale ? leftScale.ticks(5) : []
  const yTicksRight: number[] = rightScale ? rightScale.ticks(5) : []
  const formatTime = d3.timeFormat('%m-%d %H:%M')

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Data chart">
      <rect x={0} y={0} width={width} height={height} rx={12} className="chart-surface" />

      {yTicksLeft.map((tick: number) => {
        const y = leftScale ? leftScale(tick) : 0
        return <line key={`y-${tick}`} x1={paddingX} x2={width - paddingX} y1={y} y2={y} className="chart-grid" />
      })}

      {xTicks.map((tick: Date) => {
        const x = xScale(tick)
        return <line key={`x-${tick.toISOString()}`} x1={x} x2={x} y1={paddingY} y2={height - paddingY} className="chart-grid-vertical" />
      })}

      {plotted.map((s) => {
        const scale = s.side === 'left' ? leftScale : rightScale || leftScale
        if (!scale) return null
        if (s.style === 'bar') {
          const xPositions = s.points.map((p) => xScale(p.ts)).sort((a, b) => a - b)
          let minGap = innerWidth
          for (let i = 1; i < xPositions.length; i += 1) {
            minGap = Math.min(minGap, xPositions[i] - xPositions[i - 1])
          }
          const barWidth = Math.max(6, Math.min(48, (Number.isFinite(minGap) ? minGap : innerWidth / Math.max(s.points.length, 1)) * 0.65))
          return s.points.map((p, idx) => {
            const centeredX = xScale(p.ts) - barWidth / 2
            const x = Math.min(Math.max(centeredX, paddingX), width - paddingX - barWidth)
            const y = scale(p.value)
            const h = height - paddingY - y
            return <rect key={`${s.field.name}-bar-${p.ts.getTime()}-${idx}`} x={x} y={y} width={barWidth} height={h} className="chart-bar" style={{ stroke: s.color, fill: `${s.color}33` }} />
          })
        }
        const linePath =
          s.style === 'line'
            ? d3
                .line<ChartPoint>()
                .x((d: ChartPoint) => xScale(d.ts))
                .y((d: ChartPoint) => scale(d.value))(s.points)
            : null

        return (
          <g key={`series-${s.field.name}`}>
            {s.style === 'line' && linePath ? <path d={linePath} className="chart-line" fill="none" style={{ stroke: s.color }} /> : null}
            {(s.style === 'line' || s.style === 'point') &&
              s.points.map((p, idx) => (
                <circle key={`${s.field.name}-pt-${p.ts.getTime()}-${idx}`} cx={xScale(p.ts)} cy={scale(p.value)} r={5} className="chart-point" style={{ fill: s.color, stroke: '#041019' }} />
              ))}
          </g>
        )
      })}

      <line x1={paddingX} x2={width - paddingX} y1={height - paddingY} y2={height - paddingY} className="chart-axis" />
      {leftScale && <line x1={paddingX} x2={paddingX} y1={paddingY} y2={height - paddingY} className="chart-axis" />}
      {rightScale && <line x1={width - paddingX} x2={width - paddingX} y1={paddingY} y2={height - paddingY} className="chart-axis" />}

      {yTicksLeft.map((tick: number) => (
        <text key={`ylabel-${tick}`} x={paddingX - 8} y={leftScale ? leftScale(tick) + 4 : 0} className="chart-tick" textAnchor="end">
          {formatNumber(tick)}
        </text>
      ))}

      {yTicksRight.map((tick: number) => (
        <text key={`ylabel-right-${tick}`} x={width - paddingX + 8} y={rightScale ? rightScale(tick) + 4 : 0} className="chart-tick" textAnchor="start">
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
  const [selectedFieldNames, setSelectedFieldNames] = useState<string[]>([])
  const maxSeries = 2
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
      setSelectedFieldNames([])
      return
    }

    setSelectedFieldNames((current) => {
      const validCurrent = current.filter((name) => chartableFields.some((f) => f.name === name))
      if (validCurrent.length) return validCurrent
      const defaults = chartableFields.filter((f) => f.plot?.default).map((f) => f.name)
      if (defaults.length) return defaults
      return [chartableFields[0].name]
    })
  }, [chartableFields])

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

  const seriesList = useMemo(() => {
    const palette = d3.schemeTableau10 || ['#4ce0b3', '#4cc3e0', '#e0c34c', '#e04c7f', '#7b6cff']
    return selectedFieldNames.slice(0, maxSeries).map((name, idx) => {
      const field = chartableFields.find((f) => f.name === name)
      if (!field) return null
      const unit = field.plot?.unit || (field.type === 'duration' ? 'minutes' : undefined)
      const style: ChartStyle = field.plot?.style ?? 'line'
      const color = palette[idx % palette.length]
      const points = readings
        .map((reading) => {
          const raw = reading.values[name]
          if (typeof raw === 'number') return { ts: new Date(reading.timestamp), value: raw }
          if (typeof raw === 'boolean') return { ts: new Date(reading.timestamp), value: raw ? 1 : 0 }
          return null
        })
        .filter((p) => p && !Number.isNaN(p.ts.getTime())) as ChartPoint[]
      const side: 'left' | 'right' = idx === 0 ? 'left' : 'right'
      return { field, points, color, style, unit, side }
    }).filter(Boolean) as Series[]
  }, [chartableFields, readings, selectedFieldNames])

  const totalPoints = seriesList.reduce((acc, s) => acc + s.points.length, 0)

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
                <div className="chart-multiselect">
                  <p className="control-label">Data to plot</p>
                  <div className="chart-checkboxes">
                    {chartableFields.map((field) => {
                      const checked = selectedFieldNames.includes(field.name)
                      const disableAdd = !checked && selectedFieldNames.length >= maxSeries
                      return (
                        <label key={field.name} className={`chart-checkbox${disableAdd ? ' disabled' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disableAdd}
                            onChange={() => {
                              setSelectedFieldNames((prev) => {
                                if (checked) return prev.filter((name) => name !== field.name)
                                if (prev.length >= maxSeries) return prev
                                return [...prev, field.name]
                              })
                            }}
                          />
                          <span>{field.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="chart-tags">
                  <span className="pill">Series: {selectedFieldNames.length} / {maxSeries}</span>
                  <span className="pill">Points: {totalPoints}</span>
                </div>

                <button onClick={fetchReadings} disabled={isLoadingReadings} aria-live="polite">
                  {isLoadingReadings ? 'Refreshing…' : 'Refresh data'}
                </button>
              </div>

              <div className="chart-shell">
                {readingsError ? (
                  <p className="hint">Failed to load readings: {readingsError}</p>
                ) : isLoadingReadings && totalPoints === 0 ? (
                  <p className="hint">Loading readings…</p>
                ) : (
                  <ChartSvg series={seriesList} />
                )}
              </div>

              <div className="chart-foot">
                <div className="chart-legend">
                  {seriesList.map((s) => (
                    <span key={s.field.name} className="legend-item">
                      <span className="legend-swatch" style={{ background: s.color }} />
                      <span className="legend-text">{s.field.name}</span>
                      <span className="legend-meta">{s.style}{s.unit ? ` • ${s.unit}` : ''} • {s.side} y-axis</span>
                    </span>
                  ))}
                  {seriesList.length === 0 && <span className="hint">Select at least one series.</span>}
                </div>
                <p className="hint">Showing {totalPoints} points across {seriesList.length} series</p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default App
