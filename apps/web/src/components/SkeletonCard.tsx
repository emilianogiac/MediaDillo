export function SkeletonCard() {
  return (
    <div className="rounded-lg overflow-hidden bg-surface-raised animate-pulse">
      <div className="aspect-[2/3] bg-gray-700" />
      <div className="p-2 space-y-1.5">
        <div className="h-2.5 bg-gray-700 rounded w-3/4" />
        <div className="h-2 bg-gray-800 rounded w-1/2" />
      </div>
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
      <div className="w-4 h-4 bg-gray-700 rounded flex-shrink-0" />
      <div className="w-8 h-11 bg-gray-700 rounded flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-gray-700 rounded w-48" />
        <div className="h-2.5 bg-gray-800 rounded w-16" />
      </div>
      <div className="w-12 h-4 bg-gray-700 rounded flex-shrink-0" />
      <div className="w-10 h-4 bg-gray-800 rounded flex-shrink-0" />
      <div className="w-16 h-4 bg-gray-800 rounded flex-shrink-0" />
    </div>
  )
}
