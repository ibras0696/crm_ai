import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'

export function ChatModals(props: Record<string, unknown>) {
  const {
    createChatOpen,
    setCreateChatOpen,
    newChatType,
    setNewChatType,
    setNewChatTitle,
    setSelectedMemberIds,
    newChatTitle,
    members,
    user,
    selectedMemberIds,
    handleToggleMember,
    creatingChat,
    handleCreateChat,
    addMemberOpen,
    selectedChat,
    canManageMembers,
    setAddMemberOpen,
    addableChatMembers,
    addingMemberUserId,
    setAddingMemberUserId,
    addingMember,
    handleAddMemberToSelectedChat,
  } = props as any

  return (
    <>
      {createChatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCreateChatOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Создание чата"
            className="w-full max-w-xl border-border/60"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Создать чат</CardTitle>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setCreateChatOpen(false)}
                aria-label="Закрыть окно создания чата"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Тип</label>
                <select
                  value={newChatType}
                  onChange={(e) => {
                    const value = e.target.value as 'direct' | 'group' | 'channel'
                    setNewChatType(value)
                    if (value === 'direct') {
                      setNewChatTitle('')
                      setSelectedMemberIds((prev: string[]) => prev.slice(0, 1))
                    }
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="group">Группа</option>
                  <option value="direct">Личный чат</option>
                  <option value="channel">Канал</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Название</label>
                <Input
                  value={newChatTitle}
                  onChange={(e) => setNewChatTitle(e.target.value)}
                  placeholder={newChatType === 'direct' ? 'Для личного чата не обязательно' : 'Название чата'}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Участники {newChatType === 'direct' ? '(выберите одного)' : '(опционально)'}
                </label>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
                  {members
                    .filter((m: any) => m.user_id !== user?.id)
                    .map((m: any) => {
                      const caption = `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || m.user_id
                      const checked = selectedMemberIds.includes(m.user_id)
                      return (
                        <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40">
                          <input
                            type={newChatType === 'direct' ? 'radio' : 'checkbox'}
                            name={newChatType === 'direct' ? 'direct-chat-member' : undefined}
                            checked={checked}
                            onChange={() => handleToggleMember(m.user_id)}
                          />
                          <span className="truncate">{caption}</span>
                        </label>
                      )
                    })}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateChatOpen(false)} disabled={creatingChat}>
                  Отмена
                </Button>
                <Button type="button" onClick={handleCreateChat} disabled={creatingChat}>
                  {creatingChat ? 'Создание...' : 'Создать чат'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {addMemberOpen && selectedChat && canManageMembers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setAddMemberOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Добавление участника"
            className="w-full max-w-lg border-border/60"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Добавить участника</CardTitle>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setAddMemberOpen(false)}
                aria-label="Закрыть окно добавления участника"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {addableChatMembers.length === 0 ? (
                <div className="rounded-md border border-border/60 p-3 text-sm text-muted-foreground">
                  Все участники организации уже в этом чате.
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Новый участник</label>
                    <select
                      value={addingMemberUserId}
                      onChange={(event) => setAddingMemberUserId(event.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Выберите участника</option>
                      {addableChatMembers.map((member: any) => {
                        const caption = `${member.user_first_name || ''} ${member.user_last_name || ''}`.trim() || member.user_email || member.user_id
                        return (
                          <option key={member.id} value={member.user_id}>
                            {caption}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setAddMemberOpen(false)} disabled={addingMember}>
                      Отмена
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleAddMemberToSelectedChat()}
                      disabled={!addingMemberUserId || addingMember}
                    >
                      {addingMember ? 'Добавление...' : 'Добавить'}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
