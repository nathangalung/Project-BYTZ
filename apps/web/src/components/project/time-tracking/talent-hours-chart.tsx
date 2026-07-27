import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export type TalentHours = {
  name: string
  totalHours: number
}

/** Split out so recharts loads only when the summary has rows to plot. */
export function TalentHoursChart({ data }: { data: TalentHours[] }) {
  const { t } = useTranslation('project')

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#5e677d' }} />
          <YAxis tick={{ fontSize: 11, fill: '#5e677d' }} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #d1d5db',
            }}
            formatter={(value) => [`${value} h`, t('total_hours')]}
          />
          <Bar dataKey="totalHours" fill="var(--color-accent-coral-500)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
