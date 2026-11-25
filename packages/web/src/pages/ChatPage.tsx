import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowUp,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  Copy,
  FileCode,
  Flame,
  Layers,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  Wrench,
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
  const [filterTab, setFilterTab] = useState<'all' | 'pinned'>('all');
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { subscribe } = useStreamHub();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamBuffer]);

  const loadConversations = async (q = search) => {
    try {
      const res = await apiJson<{ conversations: Conversation[] }>(
        `/api/conversations${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
      );
      setConversations(res.conversations);
      if (!activeId && res.conversations[0]) {
        setActiveId(res.conversations[0].id);
      }
    } catch {
      // Ignore initial fetch errors
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
    void apiJson<{ messages: Message[] }>(`/api/conversations/${activeId}/messages?limit=50`)
      .then((d) => setMessages(d.messages))
      .catch(() => {});
  }, [activeId]);

  useEffect(() => {
    return subscribe((ev) => {
      if (ev.channel !== 'chat' || ev.entityId !== activeId) return;
      if (ev.type === 'chat.delta') {
        const delta = (ev.payload as { delta?: string }).delta ?? '';
        setStreamBuffer((prev) => prev + delta);
      } else if (ev.type === 'chat.fallback_notice') {
        const p = ev.payload as { fromProvider: string; toProvider: string; reason: string };
        setFallbackBanner(
          `Provider ${p.fromProvider} quota exhausted (${p.reason}). Automatically handed over to ${p.toProvider}.`,
        );
      } else if (ev.type === 'chat.turn_end') {
        setStreamBuffer('');
        void apiJson<{ messages: Message[] }>(`/api/conversations/${activeId}/messages?limit=50`)
          .then((d) => setMessages(d.messages))
          .catch(() => {});
      } else if (ev.type === 'chat.error') {
        const err = (ev.payload as { error?: string }).error ?? 'Execution error';
        setStreamBuffer((prev) => `${prev}\n\n[ERROR] ${err}`);
      }
    });
  }, [subscribe, activeId]);

  const handleNewChat = async (initialTitle?: string) => {
    const res = await apiJson<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        title: initialTitle || 'New Conversation',
        provider: selectedModel.provider === 'auto' ? 'antigravity' : selectedModel.provider,
        model: selectedModel.model,
        mode,
      }),
    });
    setConversations((prev) => [res.conversation, ...prev]);
    setActiveId(res.conversation.id);
    setMessages([]);
    setStreamBuffer('');
    setFallbackBanner(null);
    setMobileSidebarOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleDeleteChat = async (id: string) => {
    await apiJson(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      setActiveId(remaining[0]?.id ?? null);
    }
  };

  const handleToggleFlag = async (
    conv: Conversation,
    field: 'isPinned' | 'isProtected' | 'isArchived',
  ) => {
    const nextVal = !conv[field];
    const res = await apiJson<{ conversation: Conversation }>(`/api/conversations/${conv.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: nextVal }),
    });
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? res.conversation : c)));
  };

  const handleAddZeroCopyAttachment = () => {
    const p = attachmentPath.trim();
    if (!p) return;
    const basename = p.split('/').filter(Boolean).pop() || p;
    setAttachments((prev) => [
      ...prev,
      {
        originalPath: p,
        basename,
        sizeBytes: 0,
        mimeType: 'application/octet-stream',
        kind: 'file',
      },
    ]);
    setAttachmentPath('');
    setShowAttachmentInput(false);
  };

  const handleVoiceInput = () => {
    const windowWithSpeech = window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      SpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition =
      windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;
    if (!Recognition) {
      alert('Speech-to-text is not supported in this browser.');
      return;
    }
    const rec = new Recognition();
    rec.lang = 'en-US';
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (ev) => {
      const transcript = ev.results[0]?.[0]?.transcript ?? '';
      if (transcript) {
        setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || sending) return;

    let targetId = activeId;
    if (!targetId) {
      const initialTitle = prompt.trim().slice(0, 36) || 'New Conversation';
      const created = await apiJson<{ conversation: Conversation }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title: initialTitle,
          provider: selectedModel.provider === 'auto' ? 'antigravity' : selectedModel.provider,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    void navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  const filteredConversations = conversations.filter((c) => {
    if (filterTab === 'pinned') return c.isPinned;
    return true;
  });

  const pinnedList = filteredConversations.filter((c) => c.isPinned);
  const unpinnedList = filteredConversations.filter((c) => !c.isPinned);

  const getModeIcon = (m: ExecutionMode) => {
    switch (m) {
      case 'plan':
        return <Layers size={11} />;
      case 'code':
        return <FileCode size={11} />;
      case 'beast':
        return <Flame size={11} />;
      case 'auto':
      default:
        return <Sparkles size={11} />;
    }
  };

  const starterPrompts = [
    {
      title: 'Architect & Plan Module',
      desc: 'Plan database schema, interfaces, and architecture before coding.',
      mode: 'plan' as ExecutionMode,
      prompt: 'Plan the architecture and database schema for an authentication and role-based access module.',
    },
    {
      title: 'Implement & Test Code',
      desc: 'Write production implementation and generate verification tests.',
      mode: 'code' as ExecutionMode,
      prompt: 'Implement a secure token refresh service with unit tests in TypeScript.',
    },
    {
      title: 'Inspect Worktree & Review Diff',
      desc: 'Review git changes, check test outcomes, and report review gate status.',
      mode: 'code' as ExecutionMode,
      prompt: 'Inspect current git status, summarize changes in the active branch, and run tests.',
    },
    {
      title: 'Autonomous Beast Execution',
      desc: 'Self-healing agent loop that writes code, runs tests, and fixes errors.',
      mode: 'beast' as ExecutionMode,
      prompt: 'Run full test suite, identify failing test cases, and automatically fix code until all tests pass.',
    },
  ];

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--az-bg)' }}>
      {/* ------------------------------------------------------------- */}
      {/* Left Conversations Sidebar (Desktop Persistent / Mobile Drawer) */}
      {/* ------------------------------------------------------------- */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 lg:w-80 border-r flex flex-col shrink-0 transition-transform duration-200 ease-in-out md:translate-x-0 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          borderColor: 'var(--az-border)',
          backgroundColor: 'var(--az-bg)',
        }}
      >
        {/* Top Action Header */}
        <div className="p-3 border-b flex items-center justify-between gap-2 shrink-0" style={{ borderColor: 'var(--az-border)' }}>
          <div className="flex items-center gap-2">
            <MessageSquare size={16} style={{ color: 'var(--az-accent)' }} />
            <span className="font-semibold text-sm">Chats</span>
            <span
              className="px-1.5 py-0.2 rounded text-[11px] font-mono opacity-80"
              style={{ backgroundColor: 'rgba(139,92,246,0.12)', color: 'var(--az-accent)' }}
            >
              {conversations.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleNewChat()}
              className="px-2.5 py-1.5 rounded text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
              style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
              title="Start New Conversation"
            >
              <Plus size={14} />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              className="md:hidden p-1.5 rounded border cursor-pointer"
              style={{ borderColor: 'var(--az-border)' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-2.5 border-b shrink-0" style={{ borderColor: 'var(--az-border)' }}>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
            <Search size={13} className="opacity-60" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                void loadConversations(e.target.value);
              }}
              placeholder="Search conversations..."
              className="w-full bg-transparent text-xs outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  void loadConversations('');
                }}
                className="opacity-60 hover:opacity-100"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Filter Tabs: All vs Pinned */}
        <div className="flex border-b text-xs shrink-0" style={{ borderColor: 'var(--az-border)' }}>
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className="flex-1 py-1.5 text-center font-medium cursor-pointer transition border-b-2"
            style={{
              borderColor: filterTab === 'all' ? 'var(--az-accent)' : 'transparent',
              color: filterTab === 'all' ? 'var(--az-accent)' : 'var(--az-fg)',
            }}
          >
            All ({conversations.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('pinned')}
            className="flex-1 py-1.5 text-center font-medium cursor-pointer transition border-b-2"
            style={{
              borderColor: filterTab === 'pinned' ? 'var(--az-accent)' : 'transparent',
              color: filterTab === 'pinned' ? 'var(--az-accent)' : 'var(--az-fg)',
            }}
          >
            Pinned ({pinnedList.length})
          </button>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredConversations.length === 0 ? (
            <div className="text-xs p-4 text-center opacity-60">
              {search ? 'No matching conversations' : 'No conversations yet'}
            </div>
          ) : (
            <>
              {/* Pinned Section */}
              {filterTab === 'all' && pinnedList.length > 0 && (
                <div className="text-[11px] font-mono uppercase opacity-50 px-2 pt-1 pb-0.5">
                  Pinned
                </div>
              )}
              {filterTab === 'all' &&
                pinnedList.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conv={conv}
                    active={conv.id === activeId}
                    onSelect={() => {
                      setActiveId(conv.id);
                      setMobileSidebarOpen(false);
                    }}
                    onToggleFlag={handleToggleFlag}
                    onDelete={handleDeleteChat}
                    getModeIcon={getModeIcon}
                  />
                ))}

              {/* Recent Section */}
              {filterTab === 'all' && pinnedList.length > 0 && unpinnedList.length > 0 && (
                <div className="text-[11px] font-mono uppercase opacity-50 px-2 pt-2 pb-0.5">
                  Recent
                </div>
              )}
              {(filterTab === 'all' ? unpinnedList : pinnedList).map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  onSelect={() => {
                    setActiveId(conv.id);
                    setMobileSidebarOpen(false);
                  }}
                  onToggleFlag={handleToggleFlag}
                  onDelete={handleDeleteChat}
                  getModeIcon={getModeIcon}
                />
              ))}
            </>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="p-2.5 border-t text-[11px] font-mono opacity-60 flex items-center justify-between shrink-0" style={{ borderColor: 'var(--az-border)' }}>
          <span>Storage: ~/.azuron/chats/</span>
          <span>WAL Mode</span>
        </div>
      </aside>

      {/* Backdrop for mobile drawer */}
      {mobileSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-xs"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* ------------------------------------------------------------- */}
      {/* Right / Main Chat Canvas (Full Height, Edge-to-Edge)          */}
      {/* ------------------------------------------------------------- */}
      <section className="flex-1 flex flex-col h-full min-w-0 overflow-hidden" style={{ backgroundColor: 'var(--az-bg)' }}>
        {/* Chat Canvas Top Header */}
        <header
          className="h-12 px-4 border-b flex items-center justify-between text-xs shrink-0"
          style={{ borderColor: 'var(--az-border)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile Sidebar Toggle Button */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-1.5 rounded border inline-flex items-center gap-1 cursor-pointer"
              style={{ borderColor: 'var(--az-border)' }}
              title="Toggle conversations list"
            >
              <MessageSquare size={13} style={{ color: 'var(--az-accent)' }} />
              <span className="font-semibold">Chats</span>
            </button>

            <span className="font-semibold text-sm truncate">
              {activeConv ? activeConv.title : 'AZURON AI Coding Agent'}
            </span>

            {activeConv && (
              <span
                className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono uppercase"
                style={{ backgroundColor: 'rgba(139,92,246,0.12)', color: 'var(--az-accent)' }}
              >
                {getModeIcon(activeConv.mode)}
                <span>{activeConv.mode}</span>
              </span>
            )}

            {activeConv && (
              <span className="hidden md:inline text-[11px] opacity-60 font-mono">
                {activeConv.provider}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleNewChat()}
              className="p-1.5 rounded border cursor-pointer inline-flex items-center gap-1 text-xs"
              style={{ borderColor: 'var(--az-border)' }}
              title="New Conversation"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">New Chat</span>
            </button>

            {activeConv && (
              <button
                type="button"
                onClick={() => void handleDeleteChat(activeConv.id)}
                className="p-1.5 rounded border cursor-pointer opacity-70 hover:opacity-100"
                style={{ borderColor: 'var(--az-border)' }}
                title="Delete this conversation"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </header>

        {/* Quota Handover Alert Banner */}
        {fallbackBanner && (
          <div
            className="mx-4 mt-3 px-3 py-2 rounded border text-xs font-mono shrink-0 flex items-center justify-between"
            style={{ borderColor: 'var(--az-accent)', backgroundColor: 'rgba(139,92,246,0.08)', color: 'var(--az-accent)' }}
          >
            <span>[HANDOVER] {fallbackBanner}</span>
            <button type="button" onClick={() => setFallbackBanner(null)} className="cursor-pointer">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Messages Viewport */}
        <div className="flex-1 overflow-y-auto px-3 py-6 md:px-8 space-y-6">
          <div className="max-w-4xl mx-auto w-full space-y-5">
            {messages.length === 0 ? (
              /* Cezar-style Hero Welcome View */
              <div className="py-8 md:py-16 text-center space-y-6">
                <div className="inline-flex p-3 rounded-2xl border" style={{ borderColor: 'var(--az-border)', backgroundColor: 'rgba(139,92,246,0.08)' }}>
                  <img
                    src="/brand/azuron-logo.webp"
                    alt="AZURON"
                    className="w-14 h-14 rounded-xl object-cover"
                  />
                </div>
                <div className="space-y-1.5">
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                    AZURON Senior Staff Agent
                  </h1>
                  <p className="text-xs md:text-sm opacity-70 max-w-md mx-auto">
                    Local-first autonomous coding assistant. Native Google Antigravity & OpenAI Codex orchestration with git worktree safety.
                  </p>
                </div>

                {/* 4 Cezar Prompt Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto pt-4 text-left">
                  {starterPrompts.map((card, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setMode(card.mode);
                        setPrompt(card.prompt);
                        textareaRef.current?.focus();
                      }}
                      className="p-3.5 rounded-xl border text-xs cursor-pointer transition text-left space-y-1 hover:border-purple-500"
                      style={{
                        borderColor: 'var(--az-border)',
                        backgroundColor: 'rgba(255,255,255,0.02)',
                      }}
                    >
                      <div className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--az-accent)' }}>
                        {getModeIcon(card.mode)}
                        <span>{card.title}</span>
                      </div>
                      <div className="text-[11px] opacity-70 leading-relaxed">
                        {card.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Message Thread */
              messages.map((m, idx) => (
                <div
                  key={m.id || idx}
                  className="rounded-xl border p-4 space-y-2.5 text-sm transition"
                  style={{
                    borderColor: m.role === 'user' ? 'rgba(139,92,246,0.35)' : 'var(--az-border)',
                    backgroundColor: m.role === 'user' ? 'rgba(139,92,246,0.04)' : 'rgba(255,255,255,0.02)',
                  }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-[11px]"
                        style={{
                          backgroundColor: m.role === 'user' ? 'var(--az-accent)' : 'rgba(139,92,246,0.2)',
                          color: m.role === 'user' ? 'var(--az-accent-fg)' : 'var(--az-accent)',
                        }}
                      >
                        {m.role === 'user' ? <User size={13} /> : <Bot size={13} />}
                      </span>
                      <span className="font-semibold text-xs">
                        {m.role === 'user' ? 'You' : 'AZURON Agent'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] font-mono opacity-60">
                      {m.tokensInput + m.tokensOutput > 0 && (
                        <span>
                          {m.tokensInput} in / {m.tokensOutput} out
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(m.content, idx)}
                        className="p-1 rounded hover:opacity-100 cursor-pointer"
                        title="Copy message"
                      >
                        {copiedIndex === idx ? <Check size={12} style={{ color: '#22C55E' }} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>

                  {/* Message Content */}
                  <div className="whitespace-pre-wrap break-words leading-relaxed text-[13px] md:text-sm pl-8">
                    {m.content}
                  </div>

                  {/* Attached Files Chips */}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 pl-8">
                      {m.attachments.map((a, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded border text-[11px] font-mono inline-flex items-center gap-1"
                          style={{ borderColor: 'var(--az-border)', backgroundColor: 'rgba(255,255,255,0.04)' }}
                        >
                          <Paperclip size={10} />
                          <span>{a.basename}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Live Streaming Delta Bubble */}
            {streamBuffer && (
              <div
                className="rounded-xl border p-4 space-y-2 text-sm"
                style={{
                  borderColor: 'var(--az-accent)',
                  backgroundColor: 'rgba(139,92,246,0.05)',
                }}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-[11px]"
                    style={{ backgroundColor: 'rgba(139,92,246,0.2)', color: 'var(--az-accent)' }}
                  >
                    <Bot size={13} />
                  </span>
                  <span className="font-semibold text-xs" style={{ color: 'var(--az-accent)' }}>
                    AZURON [STREAMING]
                  </span>
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--az-accent)' }} />
                </div>
                <div className="whitespace-pre-wrap break-words leading-relaxed text-[13px] md:text-sm pl-8 font-mono">
                  {streamBuffer}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* Bottom Docked Cezar Composer                                 */}
        {/* ------------------------------------------------------------- */}
        <div
          className="border-t p-3 md:p-4 shrink-0 shadow-lg"
          style={{
            borderColor: 'var(--az-border)',
            backgroundColor: 'var(--az-bg)',
          }}
        >
          <form onSubmit={(e) => void handleSend(e)} className="max-w-4xl mx-auto w-full space-y-2.5">
            {/* Attachment Input Bar (when paperclip toggled) */}
            {showAttachmentInput && (
              <div className="flex gap-2 p-2 rounded-lg border text-xs" style={{ borderColor: 'var(--az-border)' }}>
                <input
                  value={attachmentPath}
                  onChange={(e) => setAttachmentPath(e.target.value)}
                  placeholder="/storage/emulated/0/... (Enter exact file path for zero-copy)"
                  className="flex-1 px-2.5 py-1 rounded bg-transparent font-mono outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddZeroCopyAttachment}
                  className="px-3 py-1 rounded font-semibold cursor-pointer"
                  style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
                >
                  Attach
                </button>
                <button
                  type="button"
                  onClick={() => setShowAttachmentInput(false)}
                  className="p-1 rounded cursor-pointer opacity-60"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Attached Files Tray */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((att, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono"
                    style={{ borderColor: 'var(--az-border)', backgroundColor: 'rgba(139,92,246,0.1)' }}
                  >
                    <Paperclip size={11} />
                    <span>{att.basename}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      className="cursor-pointer hover:opacity-100 opacity-60"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Toolbar: Execution Modes (Auto, Plan, Code, Beast) + Model Selector */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              {/* Execution Mode Selector Pills */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg border" style={{ borderColor: 'var(--az-border)' }}>
                {(['auto', 'plan', 'code', 'beast'] as ExecutionMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className="px-2.5 py-1 rounded-md text-[11px] font-mono uppercase inline-flex items-center gap-1 cursor-pointer transition font-medium"
                    style={{
                      backgroundColor: mode === m ? 'var(--az-accent)' : 'transparent',
                      color: mode === m ? 'var(--az-accent-fg)' : 'var(--az-fg)',
                    }}
                  >
                    {getModeIcon(m)}
                    <span>{m}</span>
                  </button>
                ))}
              </div>

              {/* Model Selector Dropdown with Sticky "See Usage & Quota" */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModelDropdownOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono cursor-pointer"
                  style={{ borderColor: 'var(--az-border)' }}
                >
                  <span className="truncate max-w-[150px] sm:max-w-[220px]">
                    {selectedModel.provider === 'auto'
                      ? 'Auto Model'
                      : `${selectedModel.provider}: ${selectedModel.model}`}
                  </span>
                  <ChevronDown size={13} className="opacity-60" />
                </button>

                {modelDropdownOpen && (
                  <div
                    className="absolute bottom-full right-0 mb-1 w-72 rounded-xl border shadow-xl z-30 flex flex-col overflow-hidden"
                    style={{ backgroundColor: 'var(--az-bg)', borderColor: 'var(--az-border)' }}
                  >
                    <div className="p-2 border-b text-[11px] font-semibold font-mono opacity-70" style={{ borderColor: 'var(--az-border)' }}>
                      Select Active Model
                    </div>
                    <div className="max-h-56 overflow-y-auto p-1.5 space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedModel({ provider: 'auto', model: 'auto' });
                          setModelDropdownOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs cursor-pointer flex items-center justify-between"
                        style={{
                          backgroundColor:
                            selectedModel.provider === 'auto' ? 'var(--az-accent)' : 'transparent',
                          color:
                            selectedModel.provider === 'auto' ? 'var(--az-accent-fg)' : 'var(--az-fg)',
                        }}
                      >
                        <span className="font-semibold">Auto (Complexity Router)</span>
                        {selectedModel.provider === 'auto' && <Check size={12} />}
                      </button>
                      {models.map((m) => {
                        const isCurrent =
                          selectedModel.provider === m.provider && selectedModel.model === m.id;
                        return (
                          <button
                            key={`${m.provider}-${m.accountId}-${m.id}`}
                            type="button"
                            onClick={() => {
                              setSelectedModel({ provider: m.provider, model: m.id });
                              setModelDropdownOpen(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs cursor-pointer border flex items-center justify-between"
                            style={{
                              borderColor: isCurrent ? 'var(--az-accent)' : 'var(--az-border)',
                              backgroundColor: isCurrent ? 'rgba(139,92,246,0.1)' : 'transparent',
                            }}
                          >
                            <div className="min-w-0 pr-2">
                              <div className="font-medium truncate">{m.displayName}</div>
                              <div className="text-[11px] opacity-60 font-mono truncate">
                                {m.provider} {m.accountName ? `(${m.accountName})` : ''}
                              </div>
                            </div>
                            {isCurrent && <Check size={12} style={{ color: 'var(--az-accent)' }} />}
                          </button>
                        );
                      })}
                    </div>

                    {/* Sticky Bottom "See Usage & Quota" */}
                    <button
                      type="button"
                      onClick={() => {
                        setModelDropdownOpen(false);
                        setUsageModalOpen(true);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 border-t text-xs font-semibold cursor-pointer transition hover:bg-purple-500/10"
                      style={{ borderColor: 'var(--az-border)', color: 'var(--az-accent)' }}
                    >
                      <BarChart3 size={14} />
                      <span>See Usage & Quota</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Input Card with Textarea and Action Buttons */}
            <div
              className="rounded-xl border p-2.5 flex flex-col space-y-2 transition focus-within:border-purple-500 shadow-inner"
              style={{
                borderColor: 'var(--az-border)',
                backgroundColor: 'rgba(255,255,255,0.01)',
              }}
            >
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="Ask AZURON anything, plan an architecture or write code... (Shift+Enter for newline)"
                className="w-full bg-transparent text-sm outline-none resize-none leading-relaxed"
              />

              <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--az-border)' }}>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowAttachmentInput((v) => !v)}
                    className="p-1.5 rounded-lg border cursor-pointer hover:border-purple-500 transition"
                    style={{ borderColor: 'var(--az-border)' }}
                    title="Attach Zero-Copy File Path"
                  >
                    <Paperclip size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={handleVoiceInput}
                    className="p-1.5 rounded-lg border cursor-pointer transition"
                    style={{
                      borderColor: listening ? 'var(--az-accent)' : 'var(--az-border)',
                      color: listening ? 'var(--az-accent)' : 'var(--az-fg)',
                      backgroundColor: listening ? 'rgba(139,92,246,0.15)' : 'transparent',
                    }}
                    title="Voice Dictation (Speech-to-Text)"
                  >
                    {listening ? <MicOff size={14} className="animate-pulse" /> : <Mic size={14} />}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline text-[11px] opacity-40 font-mono">
                    Shift+Enter for newline
                  </span>
                  <button
                    type="submit"
                    disabled={sending || !prompt.trim()}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition shadow-sm"
                    style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
                  >
                    {sending ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <ArrowUp size={13} />
                    )}
                    <span>{sending ? 'Running' : 'Send'}</span>
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* Usage & Quota Modal                                          */}
      {/* ------------------------------------------------------------- */}
      {usageModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          onClick={() => setUsageModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border p-5 space-y-4 shadow-2xl"
            style={{ backgroundColor: 'var(--az-bg)', borderColor: 'var(--az-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--az-border)' }}>
              <div className="flex items-center gap-2">
                <BarChart3 size={16} style={{ color: 'var(--az-accent)' }} />
                <span className="text-sm font-bold">Account Usage & Quota</span>
              </div>
              <button
                type="button"
                onClick={() => setUsageModalOpen(false)}
                className="p-1 rounded-lg border cursor-pointer"
                style={{ borderColor: 'var(--az-border)' }}
              >
                <X size={15} />
              </button>
            </div>
            {accounts.length === 0 ? (
              <div className="text-xs opacity-70">No native CLI accounts connected yet.</div>
            ) : (
              <div className="space-y-2.5">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="p-3 rounded-xl border text-xs space-y-1.5"
                    style={{ borderColor: 'var(--az-border)', backgroundColor: 'rgba(255,255,255,0.02)' }}
                  >
                    <div className="flex items-center justify-between font-medium">
                      <span>{acc.accountName} ({acc.provider})</span>
                      <span className="font-mono text-[11px] uppercase opacity-75">{acc.status}</span>
                    </div>
                    {acc.accountEmail && (
                      <div className="text-[11px] font-mono opacity-70">
                        {acc.accountEmail}
                      </div>
                    )}
                    <div className="opacity-80 font-mono text-[11px]">
                      5h Limit:{' '}
                      {acc.quota?.fiveHourUsedPct !== null && acc.quota?.fiveHourUsedPct !== undefined
                        ? `${acc.quota.fiveHourUsedPct}%`
                        : 'Active / Unlimited'}
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

interface ConversationItemProps {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onToggleFlag: (conv: Conversation, field: 'isPinned' | 'isProtected' | 'isArchived') => void;
  onDelete: (id: string) => void;
  getModeIcon: (m: ExecutionMode) => React.ReactNode;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conv,
  active,
  onSelect,
  onToggleFlag,
  onDelete,
  getModeIcon,
}) => {
  return (
    <div
      onClick={onSelect}
      className="p-2.5 rounded-xl border cursor-pointer flex items-center justify-between gap-2 text-xs transition group"
      style={{
        borderColor: active ? 'var(--az-accent)' : 'var(--az-border)',
        backgroundColor: active ? 'rgba(139,92,246,0.1)' : 'transparent',
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{conv.title}</div>
        <div className="text-[11px] opacity-60 font-mono truncate flex items-center gap-1.5 mt-0.5">
          <span className="inline-flex items-center gap-0.5">
            {getModeIcon(conv.mode)}
            <span className="uppercase">{conv.mode}</span>
          </span>
          <span>•</span>
          <span>{conv.provider}</span>
        </div>
      </div>

      <div
        className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onToggleFlag(conv, 'isPinned')}
          title="Pin conversation"
          className="p-1 rounded cursor-pointer transition hover:scale-110"
          style={{ color: conv.isPinned ? 'var(--az-accent)' : 'var(--az-fg)' }}
        >
          <Pin size={12} />
        </button>
        <button
          type="button"
          onClick={() => onToggleFlag(conv, 'isProtected')}
          title="Keep Forever"
          className="p-1 rounded cursor-pointer transition hover:scale-110"
          style={{ color: conv.isProtected ? 'var(--az-accent)' : 'var(--az-fg)' }}
        >
          <ShieldCheck size={12} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(conv.id)}
          title="Delete"
          className="p-1 rounded cursor-pointer transition hover:scale-110 opacity-60 hover:opacity-100"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};
