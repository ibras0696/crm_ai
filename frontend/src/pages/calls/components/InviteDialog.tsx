import { useEffect, useState } from 'react'
import { useParticipants } from '@livekit/components-react'
import { X, UserPlus, MagnifyingGlass, Check, LinkSimple } from '@phosphor-icons/react'
import { orgApi, type MemberInfo } from '../../../lib/api'
import { callsApi } from '../../../lib/api/calls'

interface Props {
  slug: string
  onClose: () => void
}

export function InviteDialog({ slug, onClose }: Props) {
  const [members, setMembers] = useState<MemberInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [search, setSearch] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/calls?slug=${slug}`)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      // clipboard unavailable — ignore
    }
  }

  const participants = useParticipants()
  const participantIds = new Set(participants.map((p) => p.identity))

  useEffect(() => {
    orgApi.getMembers()
      .then((res) => setMembers(res.data.data ?? []))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  const filteredMembers = members.filter((m) => {
    const fullN = [m.user_first_name, m.user_last_name].filter(Boolean).join(' ')
    const name = (fullN || m.user_email || '').toLowerCase()
    return name.includes(search.toLowerCase())
  })

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const handleSend = async () => {
    if (selected.size === 0) return
    setSending(true)
    try {
      await callsApi.inviteToRoom(slug, [...selected])
      setSent(true)
      setTimeout(onClose, 1200)
    } catch {
      // ignore
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-[120] flex flex-col rounded-t-2xl bg-card border-t border-border max-h-[80vh] md:inset-auto md:left-1/2 md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:w-96 md:rounded-2xl md:border">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold">Пригласить участников</h3>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Share link */}
        <div className="px-4 py-2 border-b border-border shrink-0">
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {linkCopied ? (
              <>
                <Check size={15} weight="bold" className="text-green-500" /> Ссылка скопирована
              </>
            ) : (
              <>
                <LinkSimple size={15} /> Скопировать ссылку на созвон
              </>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent">
            <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
        </div>

        {/* Members list */}
        <div className="flex-1 overflow-y-auto py-2 min-h-0">
          {isLoading && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && filteredMembers.map((member) => {
            const inCall = participantIds.has(member.user_id)
            const isSelected = selected.has(member.user_id)
            const fullName = [member.user_first_name, member.user_last_name].filter(Boolean).join(' ')
            const displayName = fullName || member.user_email || member.user_id

            return (
              <button
                key={member.user_id}
                disabled={inCall}
                onClick={() => !inCall && toggle(member.user_id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  inCall
                    ? 'opacity-40 cursor-not-allowed'
                    : isSelected
                    ? 'bg-primary/10'
                    : 'hover:bg-accent'
                }`}
              >
                <div className="h-8 w-8 shrink-0 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  {member.user_email && fullName && (
                    <p className="text-xs text-muted-foreground truncate">{member.user_email}</p>
                  )}
                  {inCall && <p className="text-xs text-primary">Уже в звонке</p>}
                </div>
                {isSelected && !inCall && (
                  <div className="h-5 w-5 shrink-0 rounded-full bg-primary flex items-center justify-center">
                    <Check size={11} weight="bold" className="text-primary-foreground" />
                  </div>
                )}
              </button>
            )
          })}

          {!isLoading && filteredMembers.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">Участники не найдены</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border shrink-0">
          <button
            onClick={handleSend}
            disabled={selected.size === 0 || sending || sent}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              sent
                ? 'bg-green-600 text-white'
                : selected.size === 0 || sending
                ? 'bg-primary/40 text-primary-foreground/60 cursor-not-allowed'
                : 'bg-primary hover:bg-primary/90 text-primary-foreground'
            }`}
          >
            {sent ? (
              <>
                <Check size={16} weight="bold" /> Приглашения отправлены
              </>
            ) : (
              <>
                <UserPlus size={16} />
                {sending
                  ? 'Отправка...'
                  : selected.size > 0
                  ? `Пригласить (${selected.size})`
                  : 'Выберите участников'}
              </>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
