import React, { useEffect, useState } from 'react';
import {
  Archive,
  BarChart3,
  ChevronDown,
  Mic,
  MicOff,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Account,
  AttachmentRef,
  Conversation,
  ExecutionMode,
  Message,
  ModelDescriptor,
} from '@azuron/contract';
import { useStreamHub } from '../hub/StreamHubContext.js';
import { apiJson } from '../lib/api.js';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export const ChatPage: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [fallbackBanner, setFallbackBanner] = useState<string | null>(null);

  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedModel, setSelectedModel] = useState<{ provider: string; model: string }>({
    provider: 'auto',
    model: 'auto',
  });
  const [mode, setMode] = useState<ExecutionMode>('auto');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [usageModalOpen, setUsageModalOpen] = useState(false);

  const [attachmentPath, setAttachmentPath] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [showAttachmentInput, setShowAttachmentInput] = useState(false);
  const [listening, setListening] = useState(false);

  const { subscribe } = useStreamHub();

  const loadConversations = async (q = search) => {
    const res = await apiJson<{ conversations: Conversation[] }>(
      `/api/conversations${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
    );
    setConversations(res.conversations);
    if (!activeId && res.conversations[0]) {
      setActiveId(res.conversations[0].id);
    }
  };

  useEffect(() => {
    void loadConversations();
    void apiJson<{ models: ModelDescriptor[] }>('/api/models')
      .then((d) => setModels(d.models))
      .catch(() => {});
    void apiJson<{ accounts: Account[] }>('/api/accounts')
      .then((d) => setAccounts(d.accounts))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    setStreamBuffer('');
    setFallbackBanner(null);
    void apiJson<{ messages: Message[] }>(`/api/conversations/${activeId}/messages?limit=30`)
      .then((d) => setMessages(d.messages))
      .catch(() => {});
  }, [activeId]);

  useEffect(() => {
    return subscribe((ev) => {
      if (ev.channel !== 'chat' || ev.entityId !== activeId) return;
      if (ev.type === 'chat.delta') {
        setStreamBuffer((prev) => prev + String(ev.payload.delta ?? ''));
      } else if (ev.type === 'chat.fallback_notice') {
        setFallbackBanner(String(ev.payload.message ?? ''));
      } else if (ev.type === 'chat.turn_end') {
        setStreamBuffer('');
        if (activeId) {
          void apiJson<{ messages: Message[] }>(`/api/conversations/${activeId}/messages?limit=30`)
            .then((d) => setMessages(d.messages))
            .catch(() => {});
        }
      }
    });
  }, [activeId, subscribe]);

  const handleNewChat = async () => {
    const res = await apiJson<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        title: `Chat ${conversations.length + 1}`,
        provider: selectedModel.provider,
        model: selectedModel.model,
        mode,
      }),
    });
    await loadConversations();
    setActiveId(res.conversation.id);
  };

  const handleToggleFlag = async (conv: Conversation, field: 'isPinned' | 'isProtected' | 'isArchived') => {
    await apiJson(`/api/conversations/${conv.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: !conv[field] }),
    });
    await loadConversations();
  };

  const handleDeleteChat = async (id: string) => {
    await apiJson(`/api/conversations/${id}`, { method: 'DELETE' });
    if (activeId === id) setActiveId(null);
    await loadConversations();
  };

  const handleAddZeroCopyAttachment = () => {
    const trimmed = attachmentPath.trim();
    if (!trimmed) return;
    const parts = trimmed.split('/');
    const basename = parts[parts.length - 1] || trimmed;
    const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(basename);
    setAttachments((prev) => [
      ...prev,
      {
        originalPath: trimmed,
        basename,
        sizeBytes: 0,
        mimeType: isImage ? 'image/webp' : 'application/octet-stream',
        kind: isImage ? 'image' : 'file',
      },
    ]);
    setAttachmentPath('');
    setShowAttachmentInput(false);
  };

  const handleVoiceInput = () => {
    const win = window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      SpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechCtor) {
      setPrompt((p) => (p ? `${p} ` : '') + '[Voice STT unavailable in this browser]');
      return;
    }
    const rec = new SpeechCtor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (ev) => {
      const text = ev.results[0]?.[0]?.transcript ?? '';
      if (text) setPrompt((p) => (p ? `${p} ${text}` : text));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || sending) return;
    let targetId = activeId;
    if (!targetId) {
      const created = await apiJson<{ conversation: Conversation }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title: prompt.trim().slice(0, 48),
          provider: selectedModel.provider,
          model: selectedModel.model,
          mode,
        }),
      });
      targetId = created.conversation.id;
      setActiveId(targetId);
      await loadConversations();
    }

    const content = prompt.trim();
    setPrompt('');
    setSending(true);
    setStreamBuffer('');
    try {
      const res = await apiJson<{ userMessage: Message; assistantMessage: Message }>(
        `/api/conversations/${targetId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            content,
            provider: selectedModel.provider,
            model: selectedModel.model,
            mode,
            attachments,
          }),
        },
      );
      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
      setAttachments([]);
    } finally {
      setSending(false);
    }
  };

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-140px)] md:h-[calc(100vh-48px)] gap-3">
      {/* Left Thread Sidebar */}
      <div
        className="w-full md:w-72 border rounded flex flex-col shrink-0 max-h-48 md:max-h-none"
        style={{ borderColor: 'var(--az-border)' }}
      >
        <div className="p-2.5 border-b flex items-center gap-2" style={{ borderColor: 'var(--az-border)' }}>
          <div className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded border" style={{ borderColor: 'var(--az-border)' }}>
            <Search size={13} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                void loadConversations(e.target.value);
              }}
              placeholder="Search chats..."
              className="w-full bg-transparent text-xs outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleNewChat()}
            className="p-1.5 rounded cursor-pointer"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
            title="New Chat"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-xs p-3 opacity-75">No conversations yet.</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setActiveId(conv.id)}
                className="p-2 rounded border cursor-pointer flex items-center justify-between gap-2 text-xs"
                style={{
                  borderColor: conv.id === activeId ? 'var(--az-accent)' : 'var(--az-border)',
                }}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{conv.title}</div>
                  <div className="text-[11px] opacity-75 font-mono truncate">
                    {conv.provider} • {conv.mode}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => void handleToggleFlag(conv, 'isPinned')}
                    title="Pin"
                    className="p-1 rounded cursor-pointer"
                    style={{ color: conv.isPinned ? 'var(--az-accent)' : 'var(--az-fg)' }}
                  >
                    <Pin size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleFlag(conv, 'isProtected')}
                    title="Keep Forever"
                    className="p-1 rounded cursor-pointer"
                    style={{ color: conv.isProtected ? 'var(--az-accent)' : 'var(--az-fg)' }}
                  >
                    <ShieldCheck size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleFlag(conv, 'isArchived')}
                    title="Archive"
                    className="p-1 rounded cursor-pointer"
                  >
                    <Archive size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteChat(conv.id)}
                    title="Delete"
                    className="p-1 rounded cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Conversation Pane */}
      <div className="flex-1 border rounded flex flex-col min-w-0" style={{ borderColor: 'var(--az-border)' }}>
        <div
          className="px-4 py-2.5 border-b flex items-center justify-between text-xs"
          style={{ borderColor: 'var(--az-border)' }}
        >
          <span className="font-semibold truncate">{activeConv ? activeConv.title : 'AZURON Persistent Chat'}</span>
          <span className="font-mono opacity-80">~/.azuron/chats/</span>
        </div>

        {fallbackBanner && (
          <div
            className="mx-3 mt-3 px-3 py-2 rounded border text-xs font-mono"
            style={{ borderColor: 'var(--az-accent)', color: 'var(--az-accent)' }}
          >
            [HANDOVER] {fallbackBanner}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className="p-3 rounded border text-sm"
              style={{
                borderColor: m.role === 'user' ? 'var(--az-accent)' : 'var(--az-border)',
              }}
            >
              <div className="flex items-center justify-between text-[11px] font-mono opacity-80 mb-1">
                <span>{m.role.toUpperCase()}</span>
                <span>
                  {m.tokensInput + m.tokensOutput > 0
                    ? `${m.tokensInput} in / ${m.tokensOutput} out`
                    : ''}
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
              {m.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {m.attachments.map((a, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded border text-[11px] font-mono"
                      style={{ borderColor: 'var(--az-border)' }}
                    >
                      {a.basename} ({a.originalPath})
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {streamBuffer && (
            <div className="p-3 rounded border text-sm" style={{ borderColor: 'var(--az-border)' }}>
              <div className="text-[11px] font-mono mb-1" style={{ color: 'var(--az-accent)' }}>
                ASSISTANT [STREAMING]
              </div>
              <div className="whitespace-pre-wrap break-words">{streamBuffer}</div>
            </div>
          )}
        </div>

        {/* Composer Toolbar & Input */}
        <form onSubmit={(e) => void handleSend(e)} className="p-3 border-t space-y-2" style={{ borderColor: 'var(--az-border)' }}>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((att, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono"
                  style={{ borderColor: 'var(--az-border)' }}
                >
                  <span>{att.basename}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    className="cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {showAttachmentInput && (
            <div className="flex gap-2">
              <input
                value={attachmentPath}
                onChange={(e) => setAttachmentPath(e.target.value)}
                placeholder="/storage/emulated/0/... (Zero-copy path)"
                className="flex-1 px-2.5 py-1.5 rounded border bg-transparent text-xs font-mono outline-none"
                style={{ borderColor: 'var(--az-border)' }}
              />
              <button
                type="button"
                onClick={handleAddZeroCopyAttachment}
                className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer"
                style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
              >
                Attach Path
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Scrollable Clickable Model Selector + Pinned See Usage */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelDropdownOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-mono cursor-pointer"
                style={{ borderColor: 'var(--az-border)' }}
              >
                <span>
                  {selectedModel.provider === 'auto'
                    ? 'Auto Model'
                    : `${selectedModel.provider}: ${selectedModel.model}`}
                </span>
                <ChevronDown size={13} />
              </button>

              {modelDropdownOpen && (
                <div
                  className="absolute bottom-full left-0 mb-1 w-72 rounded border z-30 flex flex-col"
                  style={{ backgroundColor: 'var(--az-bg)', borderColor: 'var(--az-border)' }}
                >
                  <div className="max-h-56 overflow-y-auto p-1.5 space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedModel({ provider: 'auto', model: 'auto' });
                        setModelDropdownOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded text-xs cursor-pointer"
                      style={{
                        backgroundColor:
                          selectedModel.provider === 'auto' ? 'var(--az-accent)' : 'transparent',
                        color:
                          selectedModel.provider === 'auto' ? 'var(--az-accent-fg)' : 'var(--az-fg)',
                      }}
                    >
                      Auto (Complexity Router)
                    </button>
                    {models.map((m) => (
                      <button
                        key={`${m.provider}-${m.accountId}-${m.id}`}
                        type="button"
                        onClick={() => {
                          setSelectedModel({ provider: m.provider, model: m.id });
                          setModelDropdownOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded text-xs cursor-pointer border"
                        style={{ borderColor: 'var(--az-border)' }}
                      >
                        <div className="font-medium truncate">{m.displayName}</div>
                        <div className="text-[11px] opacity-75 font-mono truncate">
                          {m.provider} {m.accountName ? `(${m.accountName})` : ''} • {m.status}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Sticky Bottom "See Usage & Quota" */}
                  <button
                    type="button"
                    onClick={() => {
                      setModelDropdownOpen(false);
                      setUsageModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 border-t text-xs font-medium cursor-pointer"
                    style={{ borderColor: 'var(--az-border)', color: 'var(--az-accent)' }}
                  >
                    <BarChart3 size={14} />
                    <span>See Usage & Quota</span>
                  </button>
                </div>
              )}
            </div>

            {/* Execution Modes: Plan, Code, Beast, Auto */}
            <div className="flex items-center gap-1">
              {(['auto', 'plan', 'code', 'beast'] as ExecutionMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className="px-2 py-1 rounded border text-[11px] font-mono uppercase cursor-pointer"
                  style={{
                    backgroundColor: mode === m ? 'var(--az-accent)' : 'transparent',
                    color: mode === m ? 'var(--az-accent-fg)' : 'var(--az-fg)',
                    borderColor: mode === m ? 'var(--az-accent)' : 'var(--az-border)',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAttachmentInput((v) => !v)}
              className="p-2 rounded border cursor-pointer"
              style={{ borderColor: 'var(--az-border)' }}
              title="Attach Zero-Copy File Path"
            >
              <Paperclip size={15} />
            </button>
            <button
              type="button"
              onClick={handleVoiceInput}
              className="p-2 rounded border cursor-pointer"
              style={{
                borderColor: listening ? 'var(--az-accent)' : 'var(--az-border)',
                color: listening ? 'var(--az-accent)' : 'var(--az-fg)',
              }}
              title="Speech to Text"
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask AZURON to plan, code, or verify..."
              className="flex-1 px-3 py-2 rounded border bg-transparent text-sm outline-none"
              style={{ borderColor: 'var(--az-border)' }}
            />
            <button
              type="submit"
              disabled={sending}
              className="px-3.5 py-2 rounded text-sm font-medium inline-flex items-center gap-1.5 cursor-pointer"
              style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
            >
              <Send size={14} />
              <span>{sending ? 'Running' : 'Send'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Quick Usage & Quota Modal */}
      {usageModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
          onClick={() => setUsageModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded border p-4 space-y-3"
            style={{ backgroundColor: 'var(--az-bg)', borderColor: 'var(--az-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--az-border)' }}>
              <span className="text-sm font-semibold">Account Usage & Quota</span>
              <button
                type="button"
                onClick={() => setUsageModalOpen(false)}
                className="p-1 rounded border cursor-pointer"
                style={{ borderColor: 'var(--az-border)' }}
              >
                <X size={15} />
              </button>
            </div>
            {accounts.length === 0 ? (
              <div className="text-xs opacity-80">No native CLI accounts connected yet.</div>
            ) : (
              <div className="space-y-2">
                {accounts.map((acc) => (
                  <div key={acc.id} className="p-2.5 rounded border text-xs space-y-1" style={{ borderColor: 'var(--az-border)' }}>
                    <div className="flex items-center justify-between font-medium">
                      <span>{acc.accountName} ({acc.provider})</span>
                      <span className="font-mono">{acc.status}</span>
                    </div>
                    <div className="opacity-75 font-mono">
                      5h Limit: {acc.quota?.fiveHourUsedPct !== null && acc.quota?.fiveHourUsedPct !== undefined ? `${acc.quota.fiveHourUsedPct}%` : 'Unavailable'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
