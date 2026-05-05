import { useParams } from 'react-router-dom'

export function SeasonDetailPage() {
  const { id, seasonNumber } = useParams<{ id: string; seasonNumber: string }>()
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">
        Show #{id} — Season {seasonNumber}
      </h1>
      <p className="text-gray-500">Season detail — coming in Epic 6.</p>
    </div>
  )
}
