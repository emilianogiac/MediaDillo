export function DashboardPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Movies', value: '—' },
          { label: 'TV Shows', value: '—' },
          { label: 'Episodes', value: '—' },
          { label: 'Health issues', value: '—' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-raised rounded-xl p-4 border border-gray-800">
            <div className="text-3xl font-bold text-accent">{stat.value}</div>
            <div className="text-sm text-gray-400 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-8 text-gray-500 text-sm">
        Run a library scan to populate your dashboard.
      </p>
    </div>
  )
}
