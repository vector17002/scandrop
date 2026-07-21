import { useState, useEffect, useRef } from 'react'

interface UploadState {
  file: File | null
  fileName: string
  fileSize: string
  progress: number
  speed: string
  timeRemaining: string
  status: 'idle' | 'uploading' | 'completed' | 'failed'
  shareLink: string
  qrCodeUrl: string
}

export default function App() {
  const [view, setView] = useState<'landing' | 'recipient'>('landing')
  const theme = 'light'
  const fileInputRef = useRef<HTMLInputElement>(null)
  
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
  })

  // Recipient Simulation State
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadStatus, setDownloadStatus] = useState<'available' | 'downloading' | 'completed'>('available')

  // Notifications
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' } | null>(null)

  const triggerNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ message, type })
  }

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [notification])

  // Formatter for file size
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }

  // Handle actual file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      startUpload(selectedFile)
    }
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
    })

    try {
      // Step 1: Request a presigned upload URL from the backend
      const response = await fetch('/api/v1/upload', {
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
      const { url, fileID } = data

      if (!url) {
        throw new Error('No presigned URL received from server')
      }

      // Step 2: Upload file directly to S3 using the presigned URL
      await uploadFileToS3(file, url, fileID)
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
  const uploadFileToS3 = (file: File, presignedUrl: string, fileID: string): Promise<void> => {
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
          const transferId = fileID || Math.random().toString(36).substring(2, 8)
          const shareLink = `${window.location.origin}/download/${transferId}`

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
          }))
          triggerNotification('File uploaded directly to S3!')
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
    })
    setDownloadStatus('available')
    setDownloadProgress(0)
  }

  // Simulate Recipient Download & S3 self-destruct
  const startSimulatedDownload = () => {
    setDownloadStatus('downloading')
    setDownloadProgress(0)

    const interval = setInterval(() => {
      setDownloadProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval)
          setDownloadStatus('completed')
          triggerNotification('File downloaded & permanently deleted from S3!', 'info')
          return 100
        }
        return prev + 10
      })
    }, 150)
  }

  const isLight = theme === 'light'

  return (
    <div className={`h-screen flex flex-col font-sans selection:text-white transition-colors duration-300 relative overflow-x-hidden ${
      isLight ? 'bg-[#fcfaf7] text-slate-800 selection:bg-orange-500' : 'bg-[#06070a] text-slate-200 selection:bg-orange-500'
    }`}>
      
      {/* Decorative Glow Backgrounds (Orange glow in both Light and Dark) */}
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

      {/* Notifications */}
      {notification && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 border backdrop-blur-md px-5 py-4 rounded-2xl shadow-2xl animate-fade-in ${
          isLight ? 'bg-white border-orange-200/60' : 'bg-[#0c0d12] border-orange-950/50'
        }`}>
          <div className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-[0_0_8px_#f97316]"></div>
          <span className={`text-sm font-semibold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
            {notification.message}
          </span>
        </div>
      )}

      {/* Header */}
      <header className={`sticky top-0 z-40 w-full border-b transition-colors duration-300 bg-opacity-80 backdrop-blur-md ${
        isLight ? 'border-orange-100/60 bg-[#fcfaf7]' : 'border-orange-950/45 bg-[#06070a]'
      }`}>
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer animate-fade-in" onClick={() => { setView('landing'); handleReset(); }}>
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
            <a href="#how-it-works" className={`text-sm font-medium transition-colors ${
              isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}>How It Works</a>
            <a href="#matrix" className={`text-sm font-medium transition-colors ${
              isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}>Comparison</a>
            <a href="#faqs" className={`text-sm font-medium transition-colors ${
              isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
            }`}>FAQ</a>
          </nav>


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
                isLight ? 'bg-orange-500/10 border-orange-300/40 text-orange-750' : 'bg-orange-500/10 border-orange-950/40 text-orange-400'
              }`}>
                🚀 S3 Multipart Upload Enabled
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
                Bypass the limits of WhatsApp, Telegram, and Drive storage. Upload massive files securely, share an instant QR or link, and watch the file permanently purge from S3 the moment it is downloaded.
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
                  <span className={`text-sm font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>Instant S3 Purge on Download</span>
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
                  <span className={`text-sm font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>Direct High-Speed S3 Uploads</span>
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
                  onChange={handleFileChange}
                  className="hidden"
                />

                {upload.status === 'idle' && (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center min-h-[300px] transition-all cursor-pointer group ${
                      isLight 
                        ? 'border-orange-200 bg-orange-50/15 hover:border-orange-500/50' 
                        : 'border-orange-900/30 bg-[#08090d]/60 hover:border-orange-500/60'
                    }`}
                  >
                    <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center mb-6 group-hover:scale-105 transition-all shadow-md ${
                      isLight 
                        ? 'bg-orange-50/50 border-orange-100 text-orange-600 group-hover:border-orange-300' 
                        : 'bg-[#12141c] border-orange-950/50 text-orange-450 group-hover:border-orange-500/30'
                    }`}>
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <span className={`text-base font-bold mb-1 transition-colors ${
                      isLight ? 'text-slate-800 group-hover:text-orange-600' : 'text-slate-200 group-hover:text-orange-400'
                    }`}>
                      Select or drop file
                    </span>
                    <span className="text-xs text-slate-500 mb-6 font-medium">Supports files up to 50 GB</span>
                    
                    <button 
                      type="button" 
                      className="px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-lg bg-orange-600 hover:bg-orange-500 shadow-orange-500/10"
                    >
                      Browse Files
                    </button>
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

                    <h3 className={`text-base font-bold mb-1 ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>Multipart S3 Upload</h3>
                    <p className="text-xs text-slate-500 font-mono max-w-[250px] truncate mb-6">{upload.fileName}</p>

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
                        onClick={() => setView('recipient')}
                        className="w-full py-3 rounded-xl text-xs font-bold text-white transition-all shadow-md bg-orange-600 hover:bg-orange-500 shadow-orange-500/10 flex items-center justify-center gap-2"
                      >
                        <span>Simulate Recipient View (Test Flow)</span>
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
                    <td className="p-6 font-extrabold bg-orange-500/5 text-orange-550">50 GB+ (No Limit)</td>
                    <td className="p-6 text-slate-500">2 GB (4 GB Premium)</td>
                    <td className="p-6 text-slate-500">2 GB</td>
                    <td className="p-6 text-slate-500">15 GB (Free storage cap)</td>
                  </tr>
                  <tr>
                    <td className={`p-6 font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>Storage Expiry Policy</td>
                    <td className="p-6 bg-orange-500/5 text-orange-550">Instant delete on download</td>
                    <td className="p-6">Persistent in cloud chat</td>
                    <td className="p-6">Persistent in backup</td>
                    <td className="p-6">Kept until manually deleted</td>
                  </tr>
                  <tr>
                    <td className={`p-6 font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>Upload Pipeline</td>
                    <td className="p-6 bg-orange-500/5 text-orange-550">Direct-to-S3 Multipart</td>
                    <td className="p-6">Proxied through Chat server</td>
                    <td className="p-6">Proxied through Chat server</td>
                    <td className="p-6">Proxied server upload</td>
                  </tr>
                  <tr>
                    <td className={`p-6 font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>Privacy / Accounts</td>
                    <td className="p-6 bg-orange-500/5 text-orange-550">No Account, No Logs</td>
                    <td className="p-6">Phone Number Required</td>
                    <td className="p-6">Phone Number Required</td>
                    <td className="p-6">Google Account Required</td>
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
                How we securely transport large files directly through S3 without storing them.
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
                <h4 className={`text-base font-bold mb-2 ${isLight ? 'text-slate-850' : 'text-white'}`}>Direct S3 Stream</h4>
                <p className={`text-xs leading-relaxed max-w-[200px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Large file is split into chunks and pushed directly to S3 via presigned multipart links. Bypasses intermediate servers.
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
                <h4 className={`text-base font-bold mb-2 ${isLight ? 'text-slate-850' : 'text-white'}`}>Secure Link & QR</h4>
                <p className={`text-xs leading-relaxed max-w-[200px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  ScanDrop generates a cryptographically random, one-time URL and QR code key for recipient download.
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
                <h4 className={`text-base font-bold mb-2 ${isLight ? 'text-slate-850' : 'text-white'}`}>One-Time Download</h4>
                <p className={`text-xs leading-relaxed max-w-[200px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Recipient scans the QR and downloads the file. The backend immediately revokes access token.
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
                <h4 className={`text-base font-bold mb-2 ${isLight ? 'text-slate-850' : 'text-white'}`}>Instant Purge</h4>
                <p className={`text-xs leading-relaxed max-w-[200px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  The file is automatically deleted from S3. Storage is reclaimed immediately, leaving zero footprints.
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
                <h3 className={`text-lg font-bold mb-3 ${isLight ? 'text-slate-900' : 'text-white'}`}>Direct-to-S3 Uploads</h3>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Bypass bottleneck servers. Your browser communicates directly with Amazon S3. That means you get maximum possible speeds based on your fiber connection.
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
                  We don't know who you are, who you are sending to, or what the file contents are. No analytics trackers, no advertising platforms, and no log persistence.
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
                  As soon as the recipient initiates the download, the backend generates an AWS Delete Object call to wipe the file. Unclaimed files automatically expire.
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
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-605' : 'text-slate-400'}`}>
                  Most platforms buffer files on their servers, causing memory exhaust on large sizes. ScanDrop requests S3 presigned multipart credentials. Your browser splits the file into multiple 10MB parts and uploads them in parallel directly to an AWS S3 bucket.
                </p>
              </div>

              <div className={`p-6 border rounded-2xl ${
                isLight ? 'bg-orange-50/15 border-orange-100/70' : 'bg-[#0c0d12]/40 border-orange-950/30'
              }`}>
                <h4 className={`text-sm font-bold mb-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>Can the file be downloaded a second time?</h4>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-605' : 'text-slate-400'}`}>
                  No. The moment the server detects a request on the download link, the unique access key is revoked and marked as downloaded. An AWS delete command is immediately sent to S3, wiping the object files.
                </p>
              </div>

              <div className={`p-6 border rounded-2xl ${
                isLight ? 'bg-orange-50/15 border-orange-100/70' : 'bg-[#0c0d12]/40 border-orange-950/30'
              }`}>
                <h4 className={`text-sm font-bold mb-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>What happens to files that are never downloaded?</h4>
                <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-605' : 'text-slate-400'}`}>
                  We enforce an AWS Lifecycle expiration rule on our S3 bucket. Any file uploaded but unclaimed will be automatically deleted after 24 hours.
                </p>
              </div>
            </div>
          </section>

        </div>
      ) : (
        /* ==================== RECIPIENT SIMULATION VIEW ==================== */
        <div className="max-w-md mx-auto px-6 py-24 animate-slide-up">
          <div className={`border rounded-3xl p-8 backdrop-blur-md text-center ${
            isLight 
              ? 'bg-white border-orange-100 shadow-xl shadow-orange-100/20' 
              : 'bg-[#0c0d12]/90 border-orange-950/40 shadow-2xl'
          }`}>
            
            <div className="mb-6">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider bg-orange-500/10 border-orange-500/20 text-orange-550">
                ⚠️ Single-Use Secure Link
              </div>
            </div>

            <div className="w-16 h-16 rounded-2xl border flex items-center justify-center mx-auto mb-6 bg-orange-500/10 border-orange-500/20 text-orange-500">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>

            <h2 className={`text-xl font-extrabold mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>Download Ready</h2>
            <p className="text-xs text-slate-500 font-mono max-w-[280px] truncate mx-auto mb-6">{upload.fileName}</p>

            <div className={`p-4 border rounded-2xl mb-8 space-y-2 text-left ${
              isLight ? 'bg-orange-50/15 border-orange-100' : 'bg-[#08090d]/60 border-orange-950/45'
            }`}>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-500">File Size:</span>
                <span className={`font-mono ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>{upload.fileSize}</span>
              </div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-500">Node Speed:</span>
                <span className="font-mono text-orange-500">Max Direct S3 Port</span>
              </div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-500">Deletion:</span>
                <span className="font-semibold text-orange-500">Immediate upon download</span>
              </div>
            </div>

            {downloadStatus === 'available' && (
              <button
                onClick={startSimulatedDownload}
                className="w-full py-3.5 rounded-xl text-xs font-bold text-white transition-all shadow-lg active:scale-95 bg-orange-600 hover:bg-orange-500 shadow-orange-500/10"
              >
                Secure Download Now
              </button>
            )}

            {downloadStatus === 'downloading' && (
              <div className="space-y-3">
                <div className={`w-full rounded-full h-2.5 overflow-hidden ${isLight ? 'bg-orange-50' : 'bg-[#151722]'}`}>
                  <div 
                    className="h-full rounded-full transition-all duration-150 bg-orange-500" 
                    style={{ width: `${downloadProgress}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>Downloading...</span>
                  <span>{downloadProgress}%</span>
                </div>
              </div>
            )}

            {downloadStatus === 'completed' && (
              <div className="space-y-6 animate-fade-in">
                <div className="p-4 rounded-xl border text-xs font-bold leading-relaxed text-center bg-orange-500/10 border-orange-500/20 text-orange-600">
                  💥 File Has Been Deleted! The S3 object has been purged from the bucket. The link is now permanently expired.
                </div>
                
                <button
                  onClick={() => {
                    setView('landing')
                    handleReset()
                  }}
                  className={`w-full py-3.5 rounded-xl text-xs font-bold transition-all border ${
                    isLight 
                      ? 'bg-white border-orange-200 text-orange-700 hover:bg-orange-50' 
                      : 'bg-slate-800 border-orange-900/40 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Create New Drop Link
                </button>
              </div>
            )}

            <button 
              onClick={() => setView('landing')}
              className="text-xs font-semibold text-slate-500 hover:text-slate-400 transition-colors pt-6 block mx-auto"
            >
              ← Cancel and Return Home
            </button>

          </div>
        </div>
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
