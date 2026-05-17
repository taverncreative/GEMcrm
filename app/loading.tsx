export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-brand" />
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    </div>
  );
}
