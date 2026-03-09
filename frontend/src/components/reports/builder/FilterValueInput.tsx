import type { AnalyticsField, AnalyticsFilter } from '@/lib/api'

interface FilterValueInputProps {
  field?: AnalyticsField
  filter: AnalyticsFilter
  onChange: (next: AnalyticsFilter) => void
}

export default function FilterValueInput({ field, filter, onChange }: FilterValueInputProps) {
  if (!field) return null
  if (filter.op === 'is_empty' || filter.op === 'not_empty') {
    return <div className="text-xs text-muted-foreground">Значение не требуется</div>
  }
  if (filter.op === 'between') {
    const type = field.analytics_type === 'date' ? 'date' : field.analytics_type === 'number' ? 'number' : 'text'
    return (
      <div className="grid grid-cols-2 gap-2">
        <input
          type={type}
          value={String(filter.from_value ?? '')}
          onChange={(e) => onChange({ ...filter, from_value: e.target.value })}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          placeholder="От"
        />
        <input
          type={type}
          value={String(filter.to_value ?? '')}
          onChange={(e) => onChange({ ...filter, to_value: e.target.value })}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          placeholder="До"
        />
      </div>
    )
  }
  if (field.analytics_type === 'boolean') {
    return (
      <select
        value={String(filter.value ?? 'true')}
        onChange={(e) => onChange({ ...filter, value: e.target.value })}
        className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
      >
        <option value="true">Да</option>
        <option value="false">Нет</option>
      </select>
    )
  }
  const type = field.analytics_type === 'date' ? 'date' : field.analytics_type === 'number' ? 'number' : 'text'
  return (
    <input
      type={type}
      value={String(filter.value ?? '')}
      onChange={(e) => onChange({ ...filter, value: e.target.value })}
      className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
      placeholder="Значение"
    />
  )
}
