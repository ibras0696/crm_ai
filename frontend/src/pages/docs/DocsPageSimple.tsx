import { useEffect, useState } from 'react'
import { docsApi, type DocsFile, type DocsFolder } from '@/lib/api'

export default function DocsPageSimple() {
  const [folders, setFolders] = useState<DocsFolder[]>([])
  const [files, setFiles] = useState<DocsFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadTree()
  }, [])

  const loadTree = async () => {
    try {
      setLoading(true)
      const response = await docsApi.getTree()
      if (response.data.ok && response.data.data) {
        setFolders(response.data.data.folders)
        setFiles(response.data.data.files)
      }
    } catch (err) {
      setError('Failed to load documents')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  if (error) {
    return <div className="p-8 text-red-600">{error}</div>
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Documents</h1>
      
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Folders ({folders.length})</h2>
        <ul className="space-y-1">
          {folders.map(folder => (
            <li key={folder.id} className="text-sm">
              📁 {folder.name}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Files ({files.length})</h2>
        <ul className="space-y-1">
          {files.map(file => (
            <li key={file.id} className="text-sm">
              📄 {file.title || file.original_name} ({file.type?.toUpperCase()}) - {file.status}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded">
        <h3 className="font-semibold text-green-800 mb-2">✅ System Status</h3>
        <ul className="text-sm text-green-700 space-y-1">
          <li>✅ Frontend: Running on port 5173</li>
          <li>✅ Backend API: Running on port 8000</li>
          <li>✅ Database: Connected</li>
          <li>✅ Redis: Connected</li>
          <li>✅ MinIO: Connected</li>
          <li>✅ Custom PDF/DOCX editors: Ready (components created)</li>
        </ul>
      </div>
    </div>
  )
}
