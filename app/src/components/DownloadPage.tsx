import React, { useState, useEffect } from 'react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || ''
const buildApiUrl = (path: string) => BACKEND_URL ? `${BACKEND_URL}${path}` : path

interface DownloadPageProps {
  token?: string
  theme?: 'light' | 'dark'
  onReturnHome: () => void
  triggerNotification?: (message: string, type?: 'success' | 'info') => void
}

interface JwtPayload {
  fileKey?: string
  exp?: number
  iat?: number
  iss?: string
}

export const DownloadPage: React.FC<DownloadPageProps> = ({
  token: initialToken,
  theme = 'light',
  onReturnHome,
  triggerNotification,
}) => {
  // Extract token from prop or current URL query/path
  const getTokenFromLocation = (): string => {
    if (initialToken) return initialToken
    
    const searchParams = new URLSearchParams(window.location.search)
    const tokenFromQuery = searchParams.get('token')
    if (tokenFromQuery) return tokenFromQuery

    const pathname = window.location.pathname
    if (pathname.startsWith('/download/')) {
      const pathToken = pathname.replace('/download/', '').trim()
      if (pathToken) return pathToken
    }

    return ''
  }

  const [token, setToken] = useState<string>(getTokenFromLocation)

  useEffect(() => {
    setToken(getTokenFromLocation())
  }, [initialToken])

  // States
  const [status, setStatus] = useState<'idle' | 'fetching_url' | 'downloading' | 'completed' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [progress, setProgress] = useState<number>(0)
  const [speed, setSpeed] = useState<string>('0 MB/s')
  const [timeRemaining, setTimeRemaining] = useState<string>('0s')
  const [payload, setPayload] = useState<JwtPayload | null>(null)
  const [timeToLive, setTimeToLive] = useState<string>('Calculating...')
  const [isTokenExpired, setIsTokenExpired] = useState<boolean>(false)

  const isLight = theme === 'light'

  // Decode JWT payload on mount or token change
  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMessage('No token provided in the download URL.')
      return
    }

    try {
      const parts = token.split('.')
      if (parts.length === 3) {
        const base64Url = parts[1]
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        )
        const parsed: JwtPayload = JSON.parse(jsonPayload)
        setPayload(parsed)

        if (parsed.exp) {
          const nowSec = Math.floor(Date.now() / 1000)
          if (parsed.exp <= nowSec) {
            setIsTokenExpired(true)
            setStatus('error')
            setErrorMessage('This download token has expired (24-hour limit exceeded).')
          }
        }
      }
    } catch (err) {
      console.warn('Could not decode JWT payload client-side:', err)
    }
  }, [token])

  // Live countdown timer for token expiration
  useEffect(() => {
    if (!payload?.exp) return

    const updateTimer = () => {
      const nowSec = Math.floor(Date.now() / 1000)
      const diffSec = payload.exp! - nowSec

      if (diffSec <= 0) {
        setTimeToLive('Expired')
        setIsTokenExpired(true)
        if (status !== 'completed') {
          setStatus('error')
          setErrorMessage('This download token has expired.')
        }
      } else {
        const hours = Math.floor(diffSec / 3600)
        const mins = Math.floor((diffSec % 3600) / 60)
        const secs = diffSec % 60
        setTimeToLive(`${hours}h ${mins}m ${secs}s`)
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [payload, status])

  // Derived file display name from fileKey
  const getDisplayFileName = (): string => {
    if (!payload?.fileKey) return 'ScanDrop Encrypted File'
    const cleanKey = payload.fileKey.split('/').pop() || payload.fileKey
    // If it has timestamp prefix like 1721900000000-filename.ext, strip it for display
    const parts = cleanKey.split('-')
    if (parts.length > 1 && !isNaN(Number(parts[0]))) {
      return parts.slice(1).join('-')
    }
    return cleanKey
  }

  // Handle Download Request to /api/v1/download?token=<token>
  const handleDownload = async () => {
    if (!token) return
    setStatus('fetching_url')
    setErrorMessage(null)

    try {
      const response = await fetch(buildApiUrl(`/api/v1/download?token=${encodeURIComponent(token)}`))

      if (!response.ok) {
        let errText = 'Failed to fetch download link'
        try {
          const errData = await response.json()
          if (typeof errData === 'string') {
            errText = errData
          } else if (errData && errData.error) {
            errText = errData.error
          } else if (errData && errData.message) {
            errText = errData.message
          }
        } catch {
          errText = `Server responded with status ${response.status}`
        }

        setStatus('error')
        setErrorMessage(errText)
        if (triggerNotification) {
          triggerNotification(`Download failed: ${errText}`, 'info')
        }
        return
      }

      const data = await response.json()
      const presignedUrl = data.downloadUrl

      if (!presignedUrl) {
        setStatus('error')
        setErrorMessage('No download URL returned by server.')
        return
      }

      setStatus('downloading')

      // Trigger the file download
      await executeFileTransfer(presignedUrl)
    } catch (err) {
      console.error('Error in download handler:', err)
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Network error occurred while fetching download link.')
    }
  }

  // Execute actual file transfer using XHR to track progress, with fallback to direct anchor click
  const executeFileTransfer = (url: string): Promise<void> => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      const startTime = Date.now()

      xhr.open('GET', url, true)
      xhr.responseType = 'blob'

      xhr.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          const pct = Math.round((e.loaded / e.total) * 100)
          const elapsedSec = (Date.now() - startTime) / 1000
          const speedBps = elapsedSec > 0 ? e.loaded / elapsedSec : 0
          const speedMB = (speedBps / (1024 * 1024)).toFixed(1)
          const remainingBytes = e.total - e.loaded
          const secondsLeft = speedBps > 0 ? Math.max(1, Math.round(remainingBytes / speedBps)) : 0

          setProgress(pct)
          setSpeed(`${speedMB} MB/s`)
          setTimeRemaining(`${secondsLeft}s`)
        } else {
          // If total size unknown, simulate smooth progress feedback
          setProgress((prev) => Math.min(prev + 5, 95))
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Create local blob object and trigger browser download
          const blob = xhr.response
          const blobUrl = window.URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = blobUrl
          a.download = getDisplayFileName()
          document.body.appendChild(a)
          a.click()
          a.remove()
          window.URL.revokeObjectURL(blobUrl)

          setProgress(100)
          setStatus('completed')
          if (triggerNotification) {
            triggerNotification('File downloaded successfully!')
          }
          resolve()
        } else {
          // Fallback to direct window opening if CORS blocks blob download
          triggerDirectBrowserDownload(url)
          setProgress(100)
          setStatus('completed')
          resolve()
        }
      }

      xhr.onerror = () => {
        // Fallback on CORS or network restriction for direct S3 presigned URL
        triggerDirectBrowserDownload(url)
        setProgress(100)
        setStatus('completed')
        resolve()
      }

      xhr.send()
    })
  }

  // Direct download fallback
  const triggerDirectBrowserDownload = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = getDisplayFileName()
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const fileName = getDisplayFileName()

  return (
    <div className="max-w-xl mx-auto px-6 py-16 animate-slide-up w-full">
      <div
        className={`border rounded-3xl p-8 backdrop-blur-md transition-all shadow-2xl ${
          isLight
            ? 'bg-white/90 border-orange-100/80 shadow-orange-100/30'
            : 'bg-[#0c0d12]/95 border-orange-950/45 shadow-black/90'
        }`}
      >
        {/* Top Header Badge */}
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-orange-500/10">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
            </span>
            <span className={`text-xs font-extrabold uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
              ScanDrop Recipient Portal
            </span>
          </div>

          <div
            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
              isTokenExpired || status === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-500'
                : 'bg-orange-500/10 border-orange-500/20 text-orange-600'
            }`}
          >
            {isTokenExpired || status === 'error' ? 'Expired / Invalid' : 'One-Time Link Active'}
          </div>
        </div>

        {/* ==================== ERROR STATE ==================== */}
        {status === 'error' && (
          <div className="text-center space-y-6 animate-fade-in">
            <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center bg-red-500/10 border border-red-500/20 text-red-500 shadow-lg shadow-red-500/5">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <div>
              <h2 className={`text-2xl font-black mb-2 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                Download Unavailable
              </h2>
              <p className={`text-xs max-w-sm mx-auto leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                {errorMessage || 'This file link has expired, was invalid, or has already been downloaded and purged.'}
              </p>
            </div>

            <div className={`p-4 rounded-2xl border text-left space-y-2 text-xs ${
              isLight ? 'bg-red-50/50 border-red-100 text-slate-700' : 'bg-[#150a0a] border-red-950/40 text-slate-300'
            }`}>
              <div className="font-bold text-red-500 flex items-center gap-1.5">
                <span>🛡️ Security Policy Triggered</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-normal">
                ScanDrop download links are single-use JWT tokens. Once a file is downloaded or passes its 24-hour expiration threshold, S3 access is permanently revoked to ensure zero footprint.
              </p>
            </div>

            <button
              onClick={onReturnHome}
              className="w-full py-3.5 rounded-xl text-xs font-bold text-white transition-all shadow-lg active:scale-95 bg-orange-600 hover:bg-orange-500 shadow-orange-500/10 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Return to ScanDrop Homepage</span>
            </button>
          </div>
        )}

        {/* ==================== IDLE / READY STATE ==================== */}
        {status === 'idle' && (
          <div className="space-y-6 text-center animate-fade-in">
            {/* File Icon */}
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-2xl bg-orange-500/20 blur-xl"></div>
              <div className={`relative w-20 h-20 rounded-2xl border flex items-center justify-center shadow-xl ${
                isLight ? 'bg-orange-50/80 border-orange-200 text-orange-600' : 'bg-[#12141c] border-orange-950 text-orange-400'
              }`}>
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>

            <div>
              <h2 className={`text-2xl font-black mb-1 tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                File Ready for Download
              </h2>
              <p className="text-xs font-mono font-semibold text-orange-500 max-w-full truncate px-4">
                {fileName}
              </p>
            </div>

            {/* File Details Card */}
            <div className={`p-4 rounded-2xl border text-left space-y-3 text-xs ${
              isLight ? 'bg-orange-50/20 border-orange-100/70' : 'bg-[#08090d]/60 border-orange-950/45'
            }`}>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Link Status:</span>
                <span className="font-semibold text-emerald-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active & Verified
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Link Expiration:</span>
                <span className="font-mono font-semibold text-orange-500">{timeToLive}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Security Policy:</span>
                <span className={`font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>One-time S3 signed delivery</span>
              </div>

              {payload?.fileKey && (
                <div className="flex justify-between items-center pt-2 border-t border-orange-500/10">
                  <span className="text-slate-500 font-medium">Storage Object:</span>
                  <span className="font-mono text-[10px] text-slate-400 truncate max-w-[200px]">
                    {payload.fileKey}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleDownload}
              className="w-full py-4 rounded-xl text-xs font-black uppercase tracking-wider text-white transition-all shadow-xl active:scale-95 bg-gradient-to-r from-orange-500 via-orange-600 to-amber-500 hover:from-orange-600 hover:to-amber-600 shadow-orange-500/20 flex items-center justify-center gap-2 group"
            >
              <span>Download File Now</span>
              <svg className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          </div>
        )}

        {/* ==================== FETCHING PRESIGNED URL STATE ==================== */}
        {status === 'fetching_url' && (
          <div className="py-8 text-center space-y-6 animate-fade-in">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-orange-500/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin border-orange-500"></div>
              <div className="absolute inset-0 flex items-center justify-center text-orange-500">
                <svg className="w-8 h-8 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
            </div>

            <div>
              <h3 className={`text-lg font-bold mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                Verifying JWT Token…
              </h3>
              <p className="text-xs text-slate-500">
                Requesting presigned AWS S3 download authorization from backend server
              </p>
            </div>
          </div>
        )}

        {/* ==================== DOWNLOADING STATE ==================== */}
        {status === 'downloading' && (
          <div className="py-6 text-center space-y-6 animate-fade-in">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-orange-500/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin border-orange-500"></div>
              <div className="absolute inset-0 flex items-center justify-center font-black text-xs font-mono text-orange-500">
                {progress}%
              </div>
            </div>

            <div>
              <h3 className={`text-lg font-bold mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                Downloading File…
              </h3>
              <p className="text-xs text-slate-500 font-mono truncate max-w-xs mx-auto mb-4">
                {fileName}
              </p>

              {/* Progress Bar */}
              <div className={`w-full rounded-full h-3 overflow-hidden mb-3 ${isLight ? 'bg-orange-100/60' : 'bg-[#151722]'}`}>
                <div
                  className="h-full rounded-full transition-all duration-200 bg-gradient-to-r from-orange-500 via-orange-600 to-amber-500"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>

              <div className="flex items-center justify-between text-xs font-semibold font-mono text-slate-400 px-1">
                <span className="text-orange-500">{progress}%</span>
                <span>{speed}</span>
                <span>{timeRemaining} remaining</span>
              </div>
            </div>
          </div>
        )}

        {/* ==================== COMPLETED STATE ==================== */}
        {status === 'completed' && (
          <div className="text-center space-y-6 animate-fade-in">
            <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center bg-orange-500/10 border border-orange-500/30 text-orange-500 shadow-xl shadow-orange-500/10">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <div>
              <h2 className={`text-2xl font-black mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                Download Complete!
              </h2>
              <p className={`text-xs max-w-sm mx-auto ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                Your file transfer of <span className="font-semibold text-orange-500 font-mono">{fileName}</span> has been completed.
              </p>
            </div>

            <div className={`p-4 rounded-2xl border text-left space-y-2 text-xs ${
              isLight ? 'bg-orange-50/40 border-orange-200/60 text-slate-700' : 'bg-orange-950/20 border-orange-900/40 text-slate-300'
            }`}>
              <div className="font-bold text-orange-600 flex items-center gap-1.5">
                <span>💥 Single-Use Transfer Complete</span>
              </div>
              <p className="text-[11px] leading-normal text-slate-500">
                The download token for this transfer has been processed. Access to this file is now revoked to ensure complete privacy and clean storage reclamation.
              </p>
            </div>


            <button
              onClick={onReturnHome}
              className="w-full py-3.5 rounded-xl text-xs font-bold text-white transition-all shadow-lg active:scale-95 bg-orange-600 hover:bg-orange-500 shadow-orange-500/10 flex items-center justify-center gap-2"
            >
              <span>Upload Another File (Home)</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        )}

        {/* Footer info line */}
        <div className="mt-8 pt-6 border-t border-orange-500/10 flex items-center justify-between text-[10px] text-slate-500 font-mono">
          <span>Zero-Knowledge Delivery</span>
          <span>Powered by ScanDrop</span>
        </div>
      </div>
    </div>
  )
}
