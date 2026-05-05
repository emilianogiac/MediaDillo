import { useParams } from 'react-router-dom'

export function ShowDetailPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Show #{id}</h1>
      <p className="text-gray-500">Show detail — coming in Epic 6.</p>
    </div>
  )
}
