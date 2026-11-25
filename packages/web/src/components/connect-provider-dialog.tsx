import { useState } from 'react'
import { ExternalLinkIcon, KeyIcon, CheckCircle2Icon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { ProviderId } from '@open-mercato/cezar-api-client'
import { startLoginSession, sendLoginSessionInput } from '@/api/client'
import { workspaceQueryKeys } from '@/api/queries'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toaster'

interface ConnectProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: ProviderId
  label: string
}

export function ConnectProviderDialog({
  open,
  onOpenChange,
  provider,
  label,
}: ConnectProviderDialogProps) {
  const queryClient = useQueryClient()
  const [keyInput, setKeyInput] = useState('')
  const [isAuthorizing, setIsAuthorizing] = useState(false)
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const isAntigravity = provider === 'antigravity'
  const isCodex = provider === 'codex'

  const authUrl = isAntigravity
    ? 'https://aistudio.google.com/app/apikey'
    : isCodex
      ? 'https://auth.openai.com/codex/device'
      : undefined

  const handleOpenBrowser = async () => {
    try {
      setIsAuthorizing(true)
      const session = await startLoginSession({
        provider,
        method: isCodex ? 'device' : 'browser',
      })
      setActiveSessionId(session.sessionId)
      if (session.userCode) {
        setDeviceCode(session.userCode)
      }
      const targetUrl = session.url || authUrl
      if (targetUrl) {
        window.open(targetUrl, '_blank', 'noopener,noreferrer')
        toast(`Opened ${label} authorization page in your browser.`)
      }
    } catch {
      if (authUrl) {
        window.open(authUrl, '_blank', 'noopener,noreferrer')
        toast(`Opened ${label} authorization page.`)
      }
    } finally {
      setIsAuthorizing(false)
    }
  }

  const handleDirectKeyConnect = async () => {
    const key = keyInput.trim()
    if (!key) {
      toast('Please enter a valid API key or token.', { tone: 'danger' })
      return
    }

    setIsAuthorizing(true)
    try {
      let sessionId = activeSessionId
      if (!sessionId) {
        const session = await startLoginSession({ provider, method: 'key' })
        sessionId = session.sessionId
      }

      await sendLoginSessionInput(sessionId, { apiKey: key })
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.providerStatus })
      toast(`${label} authorized and connected successfully!`)
      onOpenChange(false)
      setKeyInput('')
      setDeviceCode(null)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Could not authorize with this key.', {
        tone: 'danger',
      })
    } finally {
      setIsAuthorizing(false)
    }
  }

  const handleAutoDetect = async () => {
    setIsAuthorizing(true)
    try {
      await startLoginSession({ provider, method: 'browser' })
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.providerStatus })
      toast(`${label} connected via local credentials!`)
      onOpenChange(false)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'No local credentials found.', {
        tone: 'danger',
      })
    } finally {
      setIsAuthorizing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyIcon className="size-5 text-accent" />
            Connect {label}
          </DialogTitle>
          <DialogDescription>
            Authorize directly from your browser without running terminal commands in Termux.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Method 1: Browser OAuth / Web Authorization */}
          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-ui font-semibold text-foreground">
                1-Click Browser Authorization
              </span>
              <span className="text-micro text-muted-foreground">Recommended</span>
            </div>
            <p className="text-label text-muted-foreground">
              {isAntigravity
                ? 'Sign in with your Google account to confirm and generate access.'
                : isCodex
                  ? 'Confirm your OpenAI account on the verification page.'
                  : 'Open the provider sign-in page in your browser.'}
            </p>
            {deviceCode ? (
              <div className="flex items-center justify-between rounded bg-muted px-2.5 py-1.5 text-label font-mono">
                <span>Code: <b>{deviceCode}</b></span>
                <span className="text-micro text-soft-foreground">Confirm in browser</span>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                variant="contrast"
                size="sm"
                disabled={isAuthorizing}
                onClick={() => void handleOpenBrowser()}
                className="flex items-center gap-1.5"
              >
                {isAuthorizing ? <Spinner className="size-3" /> : null}
                <span>Authorize in Browser</span>
                <ExternalLinkIcon className="size-3.5" />
              </Button>
              {isAntigravity ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isAuthorizing}
                  onClick={() => void handleAutoDetect()}
                >
                  Auto-Detect Local Google Token
                </Button>
              ) : null}
            </div>
          </div>

          {/* Method 2: Direct API Key / Token */}
          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
            <span className="text-ui font-semibold text-foreground">
              Direct Authorization (API Key / Token)
            </span>
            <p className="text-label text-muted-foreground">
              {isAntigravity
                ? 'Paste a Gemini API Key from Google AI Studio or Google Cloud token.'
                : isCodex
                  ? 'Paste your OpenAI API Key (sk-...) to connect directly.'
                  : 'Paste an API key for this provider.'}
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={isAntigravity ? 'AIza...' : isCodex ? 'sk-...' : 'API Key'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleDirectKeyConnect()
                }}
                className="flex-1 font-mono text-label"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isAuthorizing || !keyInput.trim()}
                onClick={() => void handleDirectKeyConnect()}
              >
                {isAuthorizing ? <Spinner className="size-3" /> : null}
                Connect
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
