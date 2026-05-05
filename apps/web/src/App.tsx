import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { MoviesPage } from './pages/MoviesPage'
import { MovieDetailPage } from './pages/MovieDetailPage'
import { ShowsPage } from './pages/ShowsPage'
import { ShowDetailPage } from './pages/ShowDetailPage'
import { SeasonDetailPage } from './pages/SeasonDetailPage'
import { MissingPage } from './pages/MissingPage'
import { HealthPage } from './pages/HealthPage'
import { FilesPage } from './pages/FilesPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="movies" element={<MoviesPage />} />
          <Route path="movies/:id" element={<MovieDetailPage />} />
          <Route path="shows" element={<ShowsPage />} />
          <Route path="shows/:id" element={<ShowDetailPage />} />
          <Route path="shows/:id/season/:seasonNumber" element={<SeasonDetailPage />} />
          <Route path="missing" element={<MissingPage />} />
          <Route path="health" element={<HealthPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
