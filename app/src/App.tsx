import { useState, useEffect, useRef } from 'react'
import JSZip from 'jszip'
import { DownloadPage } from './components/DownloadPage'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || ''
const buildApiUrl = (path: string) => BACKEND_URL ? `${BACKEND_URL}${path}` : path

const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB per part — must match server
const MAX_CONCURRENT_UPLOADS = 4

interface UploadState {
  file: File | null
  fileName: string
  fileSize: string
  progress: number
  speed: string
  timeRemaining: string
  status: 'idle' | 'packaging' | 'uploading' | 'completed' | 'failed'
  shareLink: string
  qrCodeUrl: string
  uploadedParts: number
  totalParts: number
  fileToken: string
}

export default function App() {
  const checkCurrentRoute = (): 'landing' | 'download' => {
    const path = window.location.pathname
    const search = window.location.search
    if (path.startsWith('/download') || search.includes('token=')) {
      return 'download'
    }
    return 'landing'
  }

  const [view, setView] = useState<'landing' | 'download'>(checkCurrentRoute)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Sync route on browser back / forward
  useEffect(() => {
    const handlePopState = () => {
      setView(checkCurrentRoute())
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  
  // Client Upload State
  const [upload, setUpload] = useState<UploadState>({
    file: null,
    fileName: '',
    fileSize: '',
    progress: 0,
    speed: '0 MB/s',
    timeRemaining: '0s',
    status: 'idle',
    shareLink: '',
    qrCodeUrl: '',
    uploadedParts: 0,
    totalParts: 0,
    fileToken: '',
  })

  // Notifications
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' } | null>(null)

  const triggerNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ message, type })
  }

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3500)
      return () => clearTimeout(timer)
    }
  }, [notification])

  const navigateToHome = () => {
    window.history.pushState({}, '', '/')
    setView('landing')
    handleReset()
  }

  const navigateToDownload = (tokenString?: string) => {
    const targetToken = tokenString || upload.fileToken
    const link = targetToken ? `/download?token=${encodeURIComponent(targetToken)}` : '/download'
    window.history.pushState({}, '', link)
    setView('download')
  }

  // Formatter for file size
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }

  interface ScannedFile {
    file: File
    path: string
  }

  // Scan items recursively from drag-and-drop filesystem entries
  const scanFileSystemEntry = async (entry: any, path = ''): Promise<ScannedFile[]> => {
    if (!entry) return []
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file: File) => resolve([{ file, path: path + file.name }]))
      })
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader()
      const entries = await new Promise<any[]>((resolve) => {
        dirReader.readEntries((entries: any[]) => resolve(entries))
      })
      const results = await Promise.all(
        entries.map((child: any) => scanFileSystemEntry(child, `${path}${entry.name}/`))
      )
      return results.flat()
    }
    return []
  }

  // Process selected or dropped items (single file, multiple files, or folder)
  const processFilesOrFolder = async (scannedItems: ScannedFile[]) => {
    if (scannedItems.length === 0) return

    // If single file without subfolder path, upload directly
    if (scannedItems.length === 1 && !scannedItems[0].path.includes('/')) {
      startUpload(scannedItems[0].file)
      return
    }

    // Multiple files or folder: bundle into a zip archive preserving directory structure
    try {
      let zipName = 'scandrop-archive.zip'
      const firstPath = scannedItems[0].path
      if (firstPath.includes('/')) {
        const topFolder = firstPath.split('/')[0]
        if (topFolder) zipName = `${topFolder}.zip`
      }

      setUpload({
        file: null,
        fileName: zipName,
        fileSize: 'Calculating...',
        progress: 0,
        speed: 'Packaging...',
        timeRemaining: 'Bundling...',
        status: 'packaging',
        shareLink: '',
        qrCodeUrl: '',
        uploadedParts: 0,
        totalParts: 0,
        fileToken: '',
      })

      const zip = new JSZip()
      for (const item of scannedItems) {
        zip.file(item.path, item.file)
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setUpload(prev => ({
          ...prev,
          progress: Math.round(metadata.percent),
          speed: 'Archiving files...',
          timeRemaining: `${Math.round(metadata.percent)}%`,
        }))
      })

      const zippedFile = new File([zipBlob], zipName, { type: 'application/zip' })
      await startUpload(zippedFile)
    } catch (err) {
      console.error('Error bundling files:', err)
      setUpload(prev => ({
        ...prev,
        status: 'failed',
        speed: '0 MB/s',
        timeRemaining: '—',
      }))
      triggerNotification(`Failed to package files: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Handle multi-file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const fileList = Array.from(files)
    const scanned: ScannedFile[] = fileList.map(file => ({
      file,
      path: (file as any).webkitRelativePath || file.name
    }))
    processFilesOrFolder(scanned)
    e.target.value = ''
  }

  // Handle folder selection
  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const fileList = Array.from(files)
    const scanned: ScannedFile[] = fileList.map(file => ({
      file,
      path: (file as any).webkitRelativePath || file.name
    }))
    processFilesOrFolder(scanned)
    e.target.value = ''
  }

  // Handle Drag & Drop for files and folders
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const items = e.dataTransfer.items
    if (!items || items.length === 0) return

    const scannedItems: ScannedFile[] = []
    const promises: Promise<ScannedFile[]>[] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const entry = (item as any).webkitGetAsEntry ? (item as any).webkitGetAsEntry() : null
      if (entry) {
        promises.push(scanFileSystemEntry(entry))
      } else {
        const file = item.getAsFile()
        if (file) scannedItems.push({ file, path: file.name })
      }
    }

    if (promises.length > 0) {
      const results = await Promise.all(promises)
      scannedItems.push(...results.flat())
    }

    if (scannedItems.length > 0) {
      processFilesOrFolder(scannedItems)
    }
  }

  // Upload a single chunk to S3 via presigned URL (for multipart uploads)
  const uploadPart = (
    chunk: Blob,
    url: string,
    partNumber: number,
    onProgress: (partNumber: number, loaded: number) => void,
  ): Promise<{ PartNumber: number; ETag: string }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(partNumber, e.loaded)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader('ETag')
          if (!etag) {
            reject(new Error(`Part ${partNumber}: No ETag in response. Ensure S3 CORS exposes the ETag header.`))
            return
          }
          resolve({ PartNumber: partNumber, ETag: etag })
        } else {
          reject(new Error(`Part ${partNumber} failed with status ${xhr.status}`))
        }
      })

      xhr.addEventListener('error', () => reject(new Error(`Part ${partNumber}: network error`)))
      xhr.addEventListener('abort', () => reject(new Error(`Part ${partNumber}: aborted`)))

      xhr.open('PUT', url)
      xhr.send(chunk)
    })
  }

  // Orchestrate multipart upload: init → parallel chunk uploads → complete
  const startMultipartUpload = async (file: File) => {
    // Step 1: Initiate multipart upload via backend
    const initResponse = await fetch(buildApiUrl('/api/v1/multipartupload'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType: file.type || 'application/octet-stream',
        fileName: file.name,
        fileSize: file.size,
      }),
    })

    if (!initResponse.ok) {
      const errBody = await initResponse.json().catch(() => ({}))
      throw new Error(errBody.error || `Server responded with ${initResponse.status}`)
    }

    const { uploadId, key, urls, fileToken } = await initResponse.json()

    if (!uploadId || !key || !urls?.length) {
      throw new Error('Invalid multipart upload initiation response')
    }

    const totalParts = urls.length
    setUpload(prev => ({ ...prev, totalParts }))

    // Step 2: Upload all parts with concurrency control
    const partProgress: number[] = new Array(totalParts).fill(0)
    const startTime = Date.now()
    const completedParts: { PartNumber: number; ETag: string }[] = []

    const onPartProgress = (partNumber: number, loaded: number) => {
      partProgress[partNumber - 1] = loaded
      const totalLoaded = partProgress.reduce((a, b) => a + b, 0)
      const progress = Math.min(99, Math.round((totalLoaded / file.size) * 100))
      const elapsedSec = (Date.now() - startTime) / 1000
      const speedBps = elapsedSec > 0 ? totalLoaded / elapsedSec : 0
      const speedMB = (speedBps / (1024 * 1024)).toFixed(1)
      const remaining = file.size - totalLoaded
      const secondsLeft = speedBps > 0 ? Math.max(1, Math.round(remaining / speedBps)) : 0

      setUpload(prev => ({
        ...prev,
        progress,
        speed: `${speedMB} MB/s`,
        timeRemaining: `${secondsLeft}s`,
      }))
    }

    // Parallel uploads with concurrency limit
    await new Promise<void>((resolve, reject) => {
      let active = 0
      let nextIndex = 0
      let failed = false

      const launchNext = () => {
        if (failed) return

        while (active < MAX_CONCURRENT_UPLOADS && nextIndex < totalParts) {
          const partInfo = (urls as { partNumber: number; url: string }[])[nextIndex++]
          const start = (partInfo.partNumber - 1) * CHUNK_SIZE
          const end = Math.min(start + CHUNK_SIZE, file.size)
          const chunk = file.slice(start, end)

          active++
          uploadPart(chunk, partInfo.url, partInfo.partNumber, onPartProgress)
            .then(result => {
              completedParts.push(result)
              active--
              setUpload(prev => ({ ...prev, uploadedParts: completedParts.length }))

              if (completedParts.length === totalParts) {
                resolve()
              } else {
                launchNext()
              }
            })
            .catch(err => {
              failed = true
              reject(err)
            })
        }
      }

      launchNext()
    })

    // Step 3: Complete multipart upload on the server
    const completeResponse = await fetch(buildApiUrl('/api/v1/multipartupload/complete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        uploadId,
        parts: [...completedParts].sort((a, b) => a.PartNumber - b.PartNumber),
      }),
    })

    if (!completeResponse.ok) {
      const errBody = await completeResponse.json().catch(() => ({}))
      throw new Error(errBody.error || `Complete multipart failed: ${completeResponse.status}`)
    }

    // Step 4: Generate share link & QR
    const token = fileToken || key
    const shareLink = `${window.location.origin}/download?token=${encodeURIComponent(token)}`
    const qrColor = 'ea580c'
    const qrBg = theme === 'light' ? 'ffffff' : '0c0d12'
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareLink)}&color=${qrColor}&bgcolor=${qrBg}`

    setUpload(prev => ({
      ...prev,
      progress: 100,
      speed: '0 MB/s',
      timeRemaining: '0s',
      status: 'completed',
      shareLink,
      qrCodeUrl: qrUrl,
      fileToken: token,
    }))
    triggerNotification('File uploaded successfully!')
  }

  // Upload file via backend API → presigned URL → direct S3 upload
  const startUpload = async (file: File) => {
    const sizeStr = formatBytes(file.size)
    setUpload({
      file,
      fileName: file.name,
      fileSize: sizeStr,
      progress: 0,
      speed: '0 MB/s',
      timeRemaining: 'Calculating...',
      status: 'uploading',
      shareLink: '',
      qrCodeUrl: '',
      uploadedParts: 0,
      totalParts: 0,
      fileToken: '',
    })

    try {
      if (file.size > CHUNK_SIZE) {
        // Large files: multipart S3 upload (chunked + parallel)
        await startMultipartUpload(file)
      } else {
        // Small files: single presigned PUT URL
        const response = await fetch(buildApiUrl('/api/v1/upload'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentType: file.type || 'application/octet-stream',
            fileName: file.name,
            fileSize: file.size,
          }),
        })

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}))
          throw new Error(errBody.error || `Server responded with ${response.status}`)
        }

        const data = await response.json()
        const { url, fileToken } = data

        if (!url) {
          throw new Error('No presigned URL received from server')
        }

        // Upload file directly to S3 using the presigned URL
        await uploadFileToS3(file, url, fileToken)
      }
    } catch (err) {
      console.error('Upload failed:', err)
      setUpload(prev => ({
        ...prev,
        status: 'failed',
        speed: '0 MB/s',
        timeRemaining: '—',
      }))
      triggerNotification(
        `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  // Direct-to-S3 upload with real progress tracking via XMLHttpRequest
  const uploadFileToS3 = (file: File, presignedUrl: string, fileToken: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const startTime = Date.now()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100)
          const elapsedSec = (Date.now() - startTime) / 1000
          const speedBps = elapsedSec > 0 ? e.loaded / elapsedSec : 0
          const speedMB = (speedBps / (1024 * 1024)).toFixed(1)
          const remaining = e.total - e.loaded
          const secondsLeft = speedBps > 0 ? Math.max(1, Math.round(remaining / speedBps)) : 0

          setUpload(prev => ({
            ...prev,
            progress,
            speed: `${speedMB} MB/s`,
            timeRemaining: `${secondsLeft}s`,
          }))
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const shareLink = `${window.location.origin}/download?token=${encodeURIComponent(fileToken)}`

          const qrColor = 'ea580c' // Orange
          const qrBg = theme === 'light' ? 'ffffff' : '0c0d12'
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareLink)}&color=${qrColor}&bgcolor=${qrBg}`

          setUpload(prev => ({
            ...prev,
            progress: 100,
            speed: '0 MB/s',
            timeRemaining: '0s',
            status: 'completed',
            shareLink,
            qrCodeUrl: qrUrl,
            fileToken,
          }))
          triggerNotification('File uploaded successfully!')
          resolve()
        } else {
          reject(new Error(`S3 upload failed with status ${xhr.status}`))
        }
      })

      xhr.addEventListener('error', () => reject(new Error('Network error during S3 upload')))
      xhr.addEventListener('abort', () => reject(new Error('Upload was aborted')))

      xhr.open('PUT', presignedUrl)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.send(file)
    })
  }

  // Reset upload states
  const handleReset = () => {
    setUpload({
      file: null,
      fileName: '',
      fileSize: '',
      progress: 0,
      speed: '0 MB/s',
      timeRemaining: '0s',
      status: 'idle',
      shareLink: '',
      qrCodeUrl: '',
      uploadedParts: 0,
      totalParts: 0,
      fileToken: '',
    })
  }

  const isLight = theme === 'light'

  return (
    <div className={`min-h-screen flex flex-col font-sans selection:text-white transition-colors duration-300 relative overflow-x-hidden ${
      isLight ? 'bg-[#fcfaf7] text-slate-800 selection:bg-orange-500' : 'bg-[#06070a] text-slate-200 selection:bg-orange-500'
    }`}>
      
      {/* Decorative Glow Backgrounds */}
      {isLight ? (
        <>
          <div className="absolute top-[-10%] left-[-15%] w-[600px] h-[600px] rounded-full bg-orange-400/8 blur-[130px] pointer-events-none animate-pulse-slow"></div>
          <div className="absolute top-[40%] right-[-10%] w-[500px] h-[500px] rounded-full bg-amber-400/6 blur-[120px] pointer-events-none"></div>
          <div className="absolute bottom-[-10%] left-[10%] w-[700px] h-[700px] rounded-full bg-orange-300/4 blur-[140px] pointer-events-none"></div>
        </>
      ) : (
        <>
          <div className="absolute top-[-10%] left-[-15%] w-[600px] h-[600px] rounded-full bg-orange-500/10 blur-[150px] pointer-events-none animate-pulse-slow"></div>
          <div className="absolute top-[40%] right-[-10%] w-[500px] h-[500px] rounded-full bg-amber-600/5 blur-[130px] pointer-events-none"></div>
          <div className="absolute bottom-[-10%] left-[10%] w-[700px] h-[700px] rounded-full bg-orange-600/5 blur-[160px] pointer-events-none"></div>
        </>
      )}

      {/* Notifications Toast */}
      {notification && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 border backdrop-blur-md px-5 py-4 rounded-2xl shadow-2xl animate-fade-in ${
          isLight ? 'bg-white/95 border-orange-200/60 text-slate-800' : 'bg-[#0c0d12]/95 border-orange-950/50 text-slate-200'
        }`}>
          <div className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-[0_0_8px_#f97316]"></div>
          <span className="text-sm font-semibold">
            {notification.message}
          </span>
        </div>
      )}

      {/* Header */}
      <header className={`sticky top-0 z-40 w-full border-b transition-colors duration-300 bg-opacity-80 backdrop-blur-md ${
        isLight ? 'border-orange-100/60 bg-[#fcfaf7]' : 'border-orange-950/45 bg-[#06070a]'
      }`}>
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer animate-fade-in" onClick={navigateToHome}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg bg-gradient-to-tr from-orange-500 via-orange-600 to-amber-500 shadow-orange-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7l4-4m0 0l4 4m-4-4v18" />
              </svg>
            </div>
            <div>
              <span className={`text-xl font-extrabold tracking-tight transition-colors ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}>
                ScanDrop
              </span>
              <span className="block text-[9px] font-bold uppercase tracking-widest leading-none text-orange-500">
                One-Time Send
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#how-it-works" onClick={() => setView('landing')} className={`text-sm font-medium transition-colors ${
              isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}>How It Works</a>
            <a href="#matrix" onClick={() => setView('landing')} className={`text-sm font-medium transition-colors ${
              isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}>Comparison</a>
            <a href="#faqs" onClick={() => setView('landing')} className={`text-sm font-medium transition-colors ${
              isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}>FAQ</a>
          </nav>

          {/* Theme Toggle Button */}
          <button
            onClick={() => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
            className={`p-2.5 rounded-xl border transition-all ${
              isLight ? 'bg-orange-50/50 border-orange-200/60 text-slate-700 hover:bg-orange-100' : 'bg-slate-900 border-orange-950/60 text-slate-300 hover:bg-slate-800'
            }`}
            title="Toggle theme"
          >
            {isLight ? (
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="flex-grow flex flex-col justify-center">
        {view === 'landing' ? (
        /* ==================== LANDING PAGE VIEW ==================== */
        <div className="animate-slide-up">
          
          {/* Hero Section */}
          <section className="max-w-7xl mx-auto px-6 pt-16 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            
            {/* Hero Copy */}
            <div className="lg:col-span-7 space-y-8 text-left">
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold uppercase tracking-wider ${
                isLight ? 'bg-orange-500/10 border-orange-300/40 text-orange-700' : 'bg-orange-500/10 border-orange-950/40 text-orange-400'
              }`}>
                🚀 Large File Support Enabled
              </div>
              
              <h1 className={`text-4xl sm:text-6xl font-black tracking-tight leading-[1.1] max-w-2xl transition-colors ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}>
                Send{' '}
                <span className="bg-gradient-to-r bg-clip-text text-transparent from-orange-500 via-orange-600 to-amber-500">
                  5GB+
                </span>{' '}
                Files.<br />
                Self-Destructs After{' '}
                <span className="underline decoration-wavy underline-offset-8 decoration-orange-500">
                  One
                </span>{' '}
                Download.
              </h1>
              
              <p className={`text-base sm:text-lg max-w-xl leading-relaxed ${
                isLight ? 'text-slate-600' : 'text-slate-400'
              }`}>
                Bypass the limits of WhatsApp, Telegram, and Drive storage. Upload massive files securely, share an instant QR or link, and watch the file permanently disappear the moment it is downloaded.
              </p>

              {/* Core Features bullets */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center mt-1 flex-shrink-0 text-[10px] font-extrabold ${
                    isLight ? 'bg-orange-500/10 border-orange-400/30 text-orange-600' : 'bg-orange-500/10 border-orange-950/30 text-orange-400'
                  }`}>✓</div>
                  <span className={`text-sm font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>No 2GB Caps (Send up to 50GB+)</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center mt-1 flex-shrink-0 text-[10px] font-extrabold ${
                    isLight ? 'bg-orange-500/10 border-orange-400/30 text-orange-600' : 'bg-orange-500/10 border-orange-950/30 text-orange-400'
                  }`}>✓</div>
                  <span className={`text-sm font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>Instant Deletion on Download</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center mt-1 flex-shrink-0 text-[10px] font-extrabold ${
                    isLight ? 'bg-orange-500/10 border-orange-400/30 text-orange-600' : 'bg-orange-500/10 border-orange-950/30 text-orange-400'
                  }`}>✓</div>
                  <span className={`text-sm font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>Zero Account or Log Tracking</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center mt-1 flex-shrink-0 text-[10px] font-extrabold ${
                    isLight ? 'bg-orange-500/10 border-orange-400/30 text-orange-600' : 'bg-orange-500/10 border-orange-950/30 text-orange-400'
                  }`}>✓</div>
                  <span className={`text-sm font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>Direct High-Speed Uploads</span>
                </div>
              </div>
            </div>

            {/* Interactive Upload Box (Call to Action Widget) */}
            <div className="lg:col-span-5">
              <div className={`border rounded-3xl p-8 backdrop-blur-md transition-all ${
                isLight 
                  ? 'bg-white border-orange-100 shadow-xl shadow-orange-100/35' 
                  : 'bg-[#0d0e12]/90 border-orange-950/40 shadow-2xl shadow-black/80'
              }`}>
                
                <input
                  type="file"
                  ref={fileInputRef}
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />

                <input
                  type="file"
                  ref={folderInputRef}
                  onChange={handleFolderChange}
                  className="hidden"
                  {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                />

                {upload.status === 'idle' && (
                  <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center min-h-[300px] transition-all relative ${
                      isDragging 
                        ? 'border-orange-500 bg-orange-500/10 scale-[1.02]' 
                        : isLight 
                          ? 'border-orange-200 bg-orange-50/15 hover:border-orange-500/50' 
                          : 'border-orange-900/30 bg-[#08090d]/60 hover:border-orange-500/60'
                    }`}
                  >
                    <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center mb-5 shadow-md ${
                      isLight 
                        ? 'bg-orange-50/50 border-orange-100 text-orange-600' 
                        : 'bg-[#12141c] border-orange-950/50 text-orange-400'
                    }`}>
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    
                    <span className={`text-base font-bold mb-1 text-center ${
                      isLight ? 'text-slate-800' : 'text-slate-200'
                    }`}>
                      {isDragging ? 'Drop file(s) or folder here' : 'Drop file(s) or folder here'}
                    </span>
                    <span className="text-xs text-slate-500 mb-6 font-medium text-center">
                      Upload individual files, multiple files, or an entire folder
                    </span>
                    
                    <div className="flex flex-wrap justify-center gap-3">
                      <button 
                        type="button" 
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-lg bg-orange-600 hover:bg-orange-500 shadow-orange-500/10 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>Select File(s)</span>
                      </button>

                      <button 
                        type="button" 
                        onClick={() => folderInputRef.current?.click()}
                        className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${
                          isLight 
                            ? 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100' 
                            : 'bg-slate-800 border-orange-900/40 text-slate-200 hover:bg-slate-700'
                        }`}
                      >
                        <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span>Select Folder</span>
                      </button>
                    </div>
                  </div>
                )}

                {upload.status === 'packaging' && (
                  <div className="flex flex-col items-center justify-center min-h-[300px]">
                    <div className="relative w-20 h-20 mb-6">
                      <div className={`absolute inset-0 rounded-full border-4 ${isLight ? 'border-orange-500/20' : 'border-orange-500/25'}`}></div>
                      <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin border-orange-500"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg className="w-7 h-7 animate-pulse text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v10a2 2 0 002 2h14a2 2 0 002-2V8m-9 4h4" />
                        </svg>
                      </div>
                    </div>

                    <h3 className={`text-base font-bold mb-1 ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>Archiving files & folder…</h3>
                    <p className="text-xs text-slate-500 font-mono max-w-[250px] truncate mb-1">{upload.fileName}</p>
                    <p className="text-[10px] font-bold font-mono mb-5 text-orange-500/60">
                      Creating zero-loss zip archive
                    </p>

                    <div className={`w-full rounded-full h-2.5 overflow-hidden mb-3 ${isLight ? 'bg-orange-50' : 'bg-[#151722]'}`}>
                      <div 
                        className="h-full rounded-full transition-all duration-200 bg-gradient-to-r from-orange-500 via-orange-600 to-amber-500" 
                        style={{ width: `${upload.progress}%` }}
                      ></div>
                    </div>

                    <div className="flex items-center justify-between w-full text-xs font-semibold font-mono text-slate-400">
                      <span className="text-orange-500">{upload.progress}%</span>
                      <span>{upload.speed}</span>
                      <span>{upload.timeRemaining}</span>
                    </div>
                  </div>
                )}

                {upload.status === 'uploading' && (
                  <div className="flex flex-col items-center justify-center min-h-[300px]">
                    <div className="relative w-20 h-20 mb-6">
                      <div className={`absolute inset-0 rounded-full border-4 ${isLight ? 'border-orange-500/20' : 'border-orange-500/25'}`}></div>
                      <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin border-orange-500"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg className="w-7 h-7 animate-pulse text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                      </div>
                    </div>

                    <h3 className={`text-base font-bold mb-1 ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>Uploading your file…</h3>
                    <p className="text-xs text-slate-500 font-mono max-w-[250px] truncate mb-1">{upload.fileName}</p>
                    <p className="text-[10px] font-bold font-mono mb-5 text-orange-500/60">
                      {upload.totalParts > 1 ? `${upload.uploadedParts} of ${upload.totalParts} chunks sent` : upload.fileSize}
                    </p>

                    <div className={`w-full rounded-full h-2.5 overflow-hidden mb-3 ${isLight ? 'bg-orange-50' : 'bg-[#151722]'}`}>
                      <div 
                        className="h-full rounded-full transition-all duration-200 bg-gradient-to-r from-orange-500 via-orange-600 to-amber-500" 
                        style={{ width: `${upload.progress}%` }}
                      ></div>
                    </div>

                    <div className="flex items-center justify-between w-full text-xs font-semibold font-mono text-slate-400">
                      <span className="text-orange-500">{upload.progress}%</span>
                      <span>{upload.speed}</span>
                      <span>{upload.timeRemaining} left</span>
                    </div>
                  </div>
                )}

                {upload.status === 'completed' && (
                  <div className="flex flex-col items-center justify-center min-h-[300px] animate-fade-in text-center">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${
                      isLight ? 'bg-orange-500/10 border border-orange-500/20 text-orange-600' : 'bg-orange-500/10 border border-orange-500/20 text-orange-400'
                    }`}>
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>

                    <h3 className={`text-lg font-bold mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>Upload Completed!</h3>
                    <p className="text-xs text-slate-500 font-semibold mb-6">{upload.fileName} ({upload.fileSize})</p>

                    {/* QR Code Container */}
                    <div className={`p-3 rounded-2xl mb-6 shadow-xl border ${isLight ? 'bg-white border-orange-100/60' : 'bg-[#0c0d12] border-orange-950/40'}`}>
                      <img src={upload.qrCodeUrl} alt="Download QR Code" className="w-36 h-36" />
                    </div>

                    {/* Links to Copy / Test */}
                    <div className="space-y-3 w-full">
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          readOnly 
                          value={upload.shareLink} 
                          className={`flex-1 border rounded-xl px-4 py-2.5 text-xs font-mono text-center focus:outline-none ${
                            isLight 
                              ? 'bg-orange-50/30 border-orange-100 text-orange-700' 
                              : 'bg-[#08090d] border-orange-950/40 text-orange-400'
                          }`}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(upload.shareLink)
                            triggerNotification('Copy link to clipboard!')
                          }}
                          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
                            isLight 
                              ? 'bg-orange-600/10 hover:bg-orange-600/20 text-orange-700 border border-orange-200/50' 
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-orange-900/40'
                          }`}
                        >
                          Copy
                        </button>
                      </div>

                      <button
                        onClick={() => navigateToDownload(upload.fileToken)}
                        className="w-full py-3 rounded-xl text-xs font-bold text-white transition-all shadow-md bg-orange-600 hover:bg-orange-500 shadow-orange-500/10 flex items-center justify-center gap-2"
                      >
                        <span>Open Recipient Download Page</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      </button>

                      <button 
                        onClick={handleReset}
                        className="text-xs font-bold text-slate-500 hover:text-slate-400 transition-colors pt-2 block mx-auto"
                      >
                        Upload Another File
                      </button>
                    </div>
                  </div>
                )}

                {upload.status === 'failed' && (
                  <div className="flex flex-col items-center justify-center min-h-[300px] animate-fade-in text-center">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${
                      isLight ? 'bg-red-500/10 border border-red-500/20 text-red-600' : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}>
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>

                    <h3 className={`text-lg font-bold mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>Upload Failed</h3>
                    <p className={`text-xs mb-6 max-w-[280px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      Something went wrong while uploading <span className="font-mono font-semibold">{upload.fileName}</span>. Please check your connection and try again.
                    </p>

                    <button
                      onClick={() => {
                        handleReset()
                        fileInputRef.current?.click()
                      }}
                      className="w-full py-3 rounded-xl text-xs font-bold text-white transition-all shadow-md bg-orange-600 hover:bg-orange-500 shadow-orange-500/10"
                    >
                      Try Again
                    </button>

                    <button 
                      onClick={handleReset}
                      className="text-xs font-bold text-slate-500 hover:text-slate-400 transition-colors pt-4 block mx-auto"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Value Prop Niche Comparison Table */}
          <section id="matrix" className={`max-w-7xl mx-auto px-6 py-20 border-t transition-colors ${
            isLight ? 'border-orange-100/50' : 'border-orange-950/30'
          }`}>
            <div className="text-center max-w-2xl mx-auto mb-16 space-y-4">
              <h2 className={`text-3xl font-extrabold tracking-tight sm:text-4xl ${isLight ? 'text-slate-900' : 'text-white'}`}>
                Why use ScanDrop?
              </h2>
              <p className={`text-sm sm:text-base ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                How ScanDrop stacks up against mainstream platforms for sending large, sensitive files.
              </p>
            </div>

            <div className={`overflow-x-auto rounded-3xl border transition-colors ${
              isLight 
                ? 'border-orange-100 bg-white shadow-xl shadow-orange-100/15' 
                : 'border-orange-950/40 bg-[#0c0d12]/90 shadow-xl'
            }`}>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`border-b transition-colors ${
                    isLight ? 'border-orange-100 bg-orange-50/30' : 'border-orange-950/40 bg-[#121319]/70'
                  }`}>
                    <th className={`p-6 text-sm font-bold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>Feature</th>
                    <th className={`p-6 text-sm font-bold ${isLight ? 'text-orange-600' : 'text-orange-400'}`}>ScanDrop</th>
                    <th className="p-6 text-sm font-bold text-slate-500">Telegram</th>
                    <th className="p-6 text-sm font-bold text-slate-500">WhatsApp</th>
                    <th className="p-6 text-sm font-bold text-slate-500">Google Drive</th>
                  </tr>
                </thead>
                <tbody className={`divide-y text-sm font-semibold transition-colors ${
                  isLight ? 'divide-orange-100/50 text-slate-700' : 'divide-orange-950/30 text-slate-300'
                }`}>
                  <tr>
                    <td className={`p-6 font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>Max File Size Limit</td>
                    <td className="p-6 font-extrabold bg-orange-500/5 text-orange-500">50 GB+ (No Limit)</td>
                    <td className="p-6 text-slate-500">2 GB (4 GB Premium)</td>
                    <td className="p-6 text-slate-500">2 GB</td>
                    <td className="p-6 text-slate-500">15 GB (Free storage cap)</td>
                  </tr>
                  <tr>
                    <td className={`p-6 font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>Storage Expiry Policy</td>
                    <td className="p-6 bg-orange-500/5 text-orange-500">Instant delete on download</td>
                    <td className="p-6 text-slate-500">Persistent in cloud chat</td>
                    <td className="p-6 text-slate-500">Persistent in backup</td>
                    <td className="p-6 text-slate-500">Kept until manually deleted</td>
                  </tr>
                  <tr>
                    <td className={`p-6 font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>Upload Pipeline</td>
                    <td className="p-6 bg-orange-500/5 text-orange-500">Direct High-Speed Upload</td>
                    <td className="p-6 text-slate-500">Proxied through Chat server</td>
                    <td className="p-6 text-slate-500">Proxied through Chat server</td>
                    <td className="p-6 text-slate-500">Proxied server upload</td>
                  </tr>
                  <tr>
                    <td className={`p-6 font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>Privacy / Accounts</td>
                    <td className="p-6 bg-orange-500/5 text-orange-500">No Account, No Logs</td>
                    <td className="p-6 text-slate-500">Phone Number Required</td>
                    <td className="p-6 text-slate-500">Phone Number Required</td>
                    <td className="p-6 text-slate-500">Google Account Required</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* How It Works Timeline */}
          <section id="how-it-works" className={`max-w-7xl mx-auto px-6 py-20 border-t transition-colors ${
            isLight ? 'border-orange-100/50' : 'border-orange-950/30'
          }`}>
            <div className="text-center max-w-2xl mx-auto mb-20 space-y-4">
              <h2 className={`text-3xl font-extrabold tracking-tight sm:text-4xl ${isLight ? 'text-slate-900' : 'text-white'}`}>
                The Single-Time Cycle
              </h2>
              <p className={`text-sm sm:text-base ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                How we securely transport large files without storing them.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
              <div className="hidden md:block absolute top-12 left-[12%] right-[12%] h-0.5 z-0 bg-gradient-to-r from-orange-400 via-orange-500 to-orange-400"></div>
              
              {/* Step 1 */}
              <div className="relative z-10 text-center flex flex-col items-center group">
                <div className={`w-20 h-20 rounded-2xl border flex items-center justify-center mb-6 transition-all duration-300 ${
                  isLight 
                    ? 'bg-white border-orange-100 group-hover:border-orange-500' 
                    : 'bg-[#0c0d12] border-orange-950 group-hover:border-orange-500'
                }`}>
                  <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-tr from-orange-500 to-orange-600">01</span>
                </div>
                <h4 className={`text-base font-bold mb-2 ${isLight ? 'text-slate-800' : 'text-white'}`}>Secure Upload</h4>
                <p className={`text-xs leading-relaxed max-w-[200px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Large files are automatically split into smaller chunks and uploaded directly to secure cloud storage.
                </p>
              </div>

              {/* Step 2 */}
              <div className="relative z-10 text-center flex flex-col items-center group">
                <div className={`w-20 h-20 rounded-2xl border flex items-center justify-center mb-6 transition-all duration-300 ${
                  isLight 
                    ? 'bg-white border-orange-100 group-hover:border-orange-500' 
                    : 'bg-[#0c0d12] border-orange-950 group-hover:border-orange-500'
                }`}>
                  <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-tr from-orange-500 to-orange-600">02</span>
                </div>
                <h4 className={`text-base font-bold mb-2 ${isLight ? 'text-slate-800' : 'text-white'}`}>Secure Link & QR</h4>
                <p className={`text-xs leading-relaxed max-w-[200px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  ScanDrop generates a cryptographically random, one-time JWT URL and QR code key for recipient download.
                </p>
              </div>

              {/* Step 3 */}
              <div className="relative z-10 text-center flex flex-col items-center group">
                <div className={`w-20 h-20 rounded-2xl border flex items-center justify-center mb-6 transition-all duration-300 ${
                  isLight 
                    ? 'bg-white border-orange-100 group-hover:border-orange-500' 
                    : 'bg-[#0c0d12] border-orange-950 group-hover:border-orange-500'
                }`}>
                  <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-tr from-orange-500 to-orange-600">03</span>
                </div>
                <h4 className={`text-base font-bold mb-2 ${isLight ? 'text-slate-800' : 'text-white'}`}>One-Time Download</h4>
                <p className={`text-xs leading-relaxed max-w-[200px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Recipient scans the QR and fetches the file via S3 presigned download URL.
                </p>
              </div>

              {/* Step 4 */}
              <div className="relative z-10 text-center flex flex-col items-center group">
                <div className={`w-20 h-20 rounded-2xl border flex items-center justify-center mb-6 transition-all duration-300 ${
                  isLight 
                    ? 'bg-white border-orange-100 group-hover:border-orange-500' 
                    : 'bg-[#0c0d12] border-orange-950 group-hover:border-orange-500'
                }`}>
                  <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-tr from-orange-500 to-orange-600">04</span>
                </div>
                <h4 className={`text-base font-bold mb-2 ${isLight ? 'text-slate-800' : 'text-white'}`}>Instant Purge</h4>
                <p className={`text-xs leading-relaxed max-w-[200px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  The file access token is immediately spent. Storage is reclaimed, leaving zero footprints.
                </p>
              </div>
            </div>
          </section>

          {/* Feature Highlights Grid */}
          <section className={`max-w-7xl mx-auto px-6 py-20 border-t transition-colors ${
            isLight ? 'border-orange-100/50' : 'border-orange-950/30'
          }`}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              
              <div className={`p-8 rounded-3xl border transition-all duration-300 ${
                isLight 
                  ? 'bg-white border-orange-100 hover:border-orange-300' 
                  : 'bg-[#0c0d12]/90 border-orange-950/45 hover:border-orange-500/20'
              }`}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6 bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className={`text-lg font-bold mb-3 ${isLight ? 'text-slate-900' : 'text-white'}`}>High-Speed Uploads</h3>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Bypass bottleneck servers. Your browser uploads directly to secure cloud storage with multi-part parallel streams.
                </p>
              </div>

              <div className={`p-8 rounded-3xl border transition-all duration-300 ${
                isLight 
                  ? 'bg-white border-orange-100 hover:border-orange-300' 
                  : 'bg-[#0c0d12]/90 border-orange-950/45 hover:border-orange-500/20'
              }`}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6 bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className={`text-lg font-bold mb-3 ${isLight ? 'text-slate-900' : 'text-white'}`}>Zero-Knowledge System</h3>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  No registration or account creation required. No analytics trackers or persistent user session database.
                </p>
              </div>

              <div className={`p-8 rounded-3xl border transition-all duration-300 ${
                isLight 
                  ? 'bg-white border-orange-100 hover:border-orange-300' 
                  : 'bg-[#0c0d12]/90 border-orange-950/45 hover:border-orange-500/20'
              }`}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6 bg-orange-500/10 border border-orange-500/20 text-orange-500">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h3 className={`text-lg font-bold mb-3 ${isLight ? 'text-slate-900' : 'text-white'}`}>Self-Destruct Triggers</h3>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  As soon as the recipient initiates download or 24 hours elapse, access keys expire automatically.
                </p>
              </div>

            </div>
          </section>

          {/* FAQs */}
          <section id="faqs" className={`max-w-4xl mx-auto px-6 py-20 border-t transition-colors ${
            isLight ? 'border-orange-100/50' : 'border-orange-950/30'
          }`}>
            <div className="text-center mb-16 space-y-4">
              <h2 className={`text-3xl font-extrabold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>Frequently Asked Questions</h2>
              <p className={`text-sm ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Everything you need to know about ScanDrop's file transfer.</p>
            </div>

            <div className="space-y-6">
              <div className={`p-6 border rounded-2xl ${
                isLight ? 'bg-orange-50/15 border-orange-100/70' : 'bg-[#0c0d12]/40 border-orange-950/30'
              }`}>
                <h4 className={`text-sm font-bold mb-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>How can ScanDrop transfer files larger than 5GB?</h4>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                  ScanDrop splits large files into smaller chunks in your browser and uploads them concurrently using AWS S3 multipart presigned URLs.
                </p>
              </div>

              <div className={`p-6 border rounded-2xl ${
                isLight ? 'bg-orange-50/15 border-orange-100/70' : 'bg-[#0c0d12]/40 border-orange-950/30'
              }`}>
                <h4 className={`text-sm font-bold mb-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>Can the file be downloaded a second time?</h4>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                  No. The JWT download token is signed with a strict single-use / 24-hour expiration policy. Once downloaded, access is revoked.
                </p>
              </div>

              <div className={`p-6 border rounded-2xl ${
                isLight ? 'bg-orange-50/15 border-orange-100/70' : 'bg-[#0c0d12]/40 border-orange-950/30'
              }`}>
                <h4 className={`text-sm font-bold mb-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>What happens to files that are never downloaded?</h4>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                  Unclaimed files automatically expire after 24 hours via S3 lifecycle policies and token invalidation.
                </p>
              </div>
            </div>
          </section>

        </div>
      ) : (
        /* ==================== DOWNLOAD PAGE VIEW ==================== */
        <DownloadPage
          theme={theme}
          token={upload.fileToken}
          onReturnHome={navigateToHome}
          triggerNotification={triggerNotification}
        />
      )}
      </main>

      {/* Footer */}
      <footer className={`border-t transition-colors ${
        isLight ? 'border-orange-100 bg-[#faf8f4]' : 'border-orange-950/40 bg-[#040406]'
      }`}>
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white bg-orange-600">
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7l4-4m0 0l4 4m-4-4v18" />
              </svg>
            </div>
            <div>
              <span className={`text-base font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>ScanDrop</span>
              <span className="block text-[8px] text-slate-500 font-mono">SECURE ONE-TIME TRANSFER DEPLOYMENT</span>
            </div>
          </div>
          <span className="text-xs text-slate-600 font-medium">
            © {new Date().getFullYear()} ScanDrop. Open-source, zero-logs direct transfer client.
          </span>
        </div>
      </footer>
    </div>
  )
}
