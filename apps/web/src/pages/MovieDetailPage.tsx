import { useParams } from 'react-router-dom'

export function MovieDetailPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Movie #{id}</h1>
      <p className="text-gray-500">Movie detail — coming in Epic 5.</p>
    </div>
  )
}
