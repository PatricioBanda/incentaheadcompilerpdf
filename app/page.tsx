'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PrototypeDashboard } from '@/components/smartcomprovante/prototype-dashboard'

export default function HomePage() {
  // This page is a fully interactive client app (Radix Tabs + heavy client dashboards).
  // Rendering it client-only avoids SSR/client hydration mismatches in the auto-generated
  // Radix `useId` attributes. The pre-mount markup is identical on server and client.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!mounted) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>
  }

  return <PrototypeDashboard />
}
