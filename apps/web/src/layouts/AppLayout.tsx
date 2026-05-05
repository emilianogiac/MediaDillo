import { Outlet, NavLink } from 'react-router-dom'

interface NavItem {
  to: string
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '⊞' },
  { to: '/movies', label: 'Movies', icon: '🎬' },
  { to: '/shows', label: 'TV Shows', icon: '📺' },
  { to: '/missing', label: 'Missing', icon: '⚠' },
  { to: '/health', label: 'Health', icon: '❤' },
  { to: '/files', label: 'Files', icon: '📁' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-56 flex-shrink-0 bg-surface-raised border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <span className="text-xl font-bold text-accent">🦔 MediaDillo</span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-white/5',
                ].join(' ')
              }
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800 text-xs text-gray-600">
          MediaDillo v0.1
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-surface">
        <Outlet />
      </main>
    </div>
  )
}
