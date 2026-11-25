/**
 * AZURON Zod Data Contracts & Shared Protocol Schemas
 *
 * Notice: Boundary validation patterns adapted from open-mercato/cezar (MIT License, (c) Patryk Lewczuk).
 */

import { z } from 'zod';
import {
  BYOK_PROVIDERS,
  EXECUTION_MODES,
  NATIVE_PROVIDERS,
  REASONING_EFFORTS,
} from './constants.js';

export const NativeProviderSchema = z.enum(NATIVE_PROVIDERS);
export type NativeProvider = z.infer<typeof NativeProviderSchema>;

export const ByokProviderSchema = z.enum(BYOK_PROVIDERS);
export type ByokProvider = z.infer<typeof ByokProviderSchema>;

export const AnyProviderSchema = z.union([
  NativeProviderSchema,
  ByokProviderSchema,
  z.literal('auto'),
]);
export type AnyProvider = z.infer<typeof AnyProviderSchema>;

export const ExecutionModeSchema = z.enum(EXECUTION_MODES);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const ReasoningEffortSchema = z.enum(REASONING_EFFORTS);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const AccountStatusSchema = z.enum([
  'active',
  'unverified',
  'expired',
  'quota_exhausted',
  'error',
]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const AccountQuotaSchema = z.object({
  fiveHourUsedPct: z.number().min(0).max(100).nullable().default(null),
  monthlyUsedPct: z.number().min(0).max(100).nullable().default(null),
  requestsRemaining: z.number().int().nonnegative().nullable().default(null),
  resetAt: z.number().int().nullable().default(null),
  planLabel: z.string().nullable().default(null),
  source: z.enum(['provider', 'unavailable']).default('unavailable'),
});
export type AccountQuota = z.infer<typeof AccountQuotaSchema>;

export const AccountSchema = z.object({
  id: z.string().min(1),
  provider: NativeProviderSchema,
  accountName: z.string().min(1).max(120),
  authProfilePath: z.string().nullable(),
  isActive: z.boolean(),
  status: AccountStatusSchema,
  quota: AccountQuotaSchema.nullable().default(null),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Account = z.infer<typeof AccountSchema>;

export const CreateAccountSchema = z.object({
  provider: NativeProviderSchema,
  accountName: z.string().min(1).max(120),
});
export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;

export const ByokKeySchema = z.object({
  id: z.string().min(1),
  provider: ByokProviderSchema,
  label: z.string().min(1).max(120),
  maskedKey: z.string(),
  status: z.enum(['active', 'invalid', 'rate_limited', 'unverified']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ByokKey = z.infer<typeof ByokKeySchema>;

export const CreateByokKeySchema = z.object({
  provider: ByokProviderSchema,
  label: z.string().min(1).max(120),
  apiKey: z.string().min(6),
});
export type CreateByokKeyInput = z.infer<typeof CreateByokKeySchema>;

export const IntegrationNameSchema = z.enum(['github', 'vercel', 'rclone']);
export type IntegrationName = z.infer<typeof IntegrationNameSchema>;

export const IntegrationStatusSchema = z.object({
  name: IntegrationNameSchema,
  connected: z.boolean(),
  source: z.enum(['env_cli', 'vault_pat', 'none']),
  accountLabel: z.string().nullable(),
  details: z.string().nullable(),
  updatedAt: z.number().int().nullable(),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const ConnectIntegrationSchema = z.object({
  name: IntegrationNameSchema,
  token: z.string().min(4),
  accountLabel: z.string().optional(),
});

export const ModelStatusSchema = z.enum([
  'available',
  'quota_exhausted',
  'locked_by_admin',
  'unavailable',
]);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const ModelDescriptorSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().default(''),
  provider: z.union([NativeProviderSchema, ByokProviderSchema]),
  accountId: z.string().nullable().default(null),
  accountName: z.string().nullable().default(null),
  status: ModelStatusSchema.default('available'),
  supportedReasoningEfforts: z.array(ReasoningEffortSchema).default([]),
  supportsTools: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  contextWindow: z.number().int().positive().nullable().default(null),
});
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>;

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  filesystemPath: z.string().min(1),
  baseBranch: z.string().min(1).default('main'),
  tags: z.array(z.string()).default([]),
  instructions: z.string().default(''),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  filesystemPath: z.string().min(1),
  baseBranch: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  instructions: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

/**
 * Zero-Copy In-Place Attachment Reference (Never duplicates files into cache)
 */
export const AttachmentRefSchema = z.object({
  originalPath: z.string().min(1),
  basename: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  kind: z.enum(['image', 'file']),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

export const ConversationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().nullable(),
  accountId: z.string().nullable(),
  provider: AnyProviderSchema,
  model: z.string().min(1),
  mode: ExecutionModeSchema.default('auto'),
  title: z.string().min(1).max(200),
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  isProtected: z.boolean(),
  lastActivityAt: z.number().int(),
  createdAt: z.number().int(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const CreateConversationSchema = z.object({
  projectId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  provider: AnyProviderSchema.default('auto'),
  model: z.string().min(1).default('auto'),
  mode: ExecutionModeSchema.default('auto'),
  title: z.string().min(1).max(200).default('New Conversation'),
});
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;

export const UpdateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  provider: AnyProviderSchema.optional(),
  model: z.string().min(1).optional(),
  mode: ExecutionModeSchema.optional(),
  accountId: z.string().nullable().optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isProtected: z.boolean().optional(),
});
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>;

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ToolCallRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  status: z.enum(['running', 'done', 'error']).default('done'),
});
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;

export const MessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: MessageRoleSchema,
  content: z.string(),
  toolCalls: z.array(ToolCallRecordSchema).default([]),
  attachments: z.array(AttachmentRefSchema).default([]),
  tokensInput: z.number().int().nonnegative().default(0),
  tokensOutput: z.number().int().nonnegative().default(0),
  tokensCached: z.number().int().nonnegative().default(0),
  costReported: z.number().nonnegative().nullable().default(null),
  createdAt: z.number().int(),
});
export type Message = z.infer<typeof MessageSchema>;

export const SendMessageSchema = z.object({
  content: z.string().min(1),
  provider: AnyProviderSchema.optional(),
  model: z.string().min(1).optional(),
  mode: ExecutionModeSchema.optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  accountId: z.string().nullable().optional(),
  attachments: z.array(AttachmentRefSchema).default([]),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const TaskStatusSchema = z.enum([
  'queued',
  'running',
  'review',
  'done',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  conversationId: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  title: z.string().min(1).max(200),
  prompt: z.string().default(''),
  status: TaskStatusSchema,
  provider: AnyProviderSchema,
  model: z.string().min(1),
  worktreePath: z.string().nullable(),
  branchName: z.string().nullable(),
  diffStat: z.string().nullable(),
  peakMemoryMb: z.number().nonnegative().default(0),
  isProtected: z.boolean().default(false),
  settledAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1),
  provider: AnyProviderSchema.default('auto'),
  model: z.string().min(1).default('auto'),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const RiskLevelSchema = z.enum(['safe', 'moderate', 'destructive']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const TerminalApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type TerminalApprovalStatus = z.infer<typeof TerminalApprovalStatusSchema>;

export const TerminalCommandSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  userPrompt: z.string().min(1),
  compiledCommand: z.string().min(1),
  explanation: z.string().min(1),
  riskLevel: RiskLevelSchema,
  approvalStatus: TerminalApprovalStatusSchema,
  exitCode: z.number().int().nullable(),
  outputLog: z.string().nullable(),
  executedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});
export type TerminalCommand = z.infer<typeof TerminalCommandSchema>;

export const CompileTerminalRequestSchema = z.object({
  projectId: z.string().min(1),
  userPrompt: z.string().min(1),
  cwd: z.string().optional(),
});

export const ApproveTerminalRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  confirmationText: z.string().optional(),
});

export const RetentionCategorySchema = z.enum([
  'task_logs',
  'inactive_chats',
  'temp_files',
  'usage_history',
]);
export type RetentionCategory = z.infer<typeof RetentionCategorySchema>;

export const RetentionPolicySchema = z.object({
  category: RetentionCategorySchema,
  retentionDays: z.number().int().positive(),
  isEnabled: z.boolean(),
  lastCleanedAt: z.number().int().nullable(),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

export const StreamEventTypeSchema = z.enum([
  'hub.connected',
  'chat.delta',
  'chat.tool_call',
  'chat.tool_result',
  'chat.fallback_notice',
  'chat.turn_end',
  'chat.error',
  'task.status',
  'task.log',
  'terminal.output',
  'terminal.exit',
  'system.log',
]);
export type StreamEventType = z.infer<typeof StreamEventTypeSchema>;

export const StreamEventSchema = z.object({
  id: z.number().int().nonnegative(),
  channel: z.enum(['chat', 'task', 'terminal', 'system']),
  entityId: z.string(),
  type: StreamEventTypeSchema,
  payload: z.record(z.unknown()),
  timestamp: z.number().int(),
});
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export const EnvironmentToolchainSchema = z.object({
  nodeVersion: z.string().nullable(),
  npmVersion: z.string().nullable(),
  pythonVersion: z.string().nullable(),
  gitUserName: z.string().nullable(),
  gitUserEmail: z.string().nullable(),
  ghAuthenticated: z.boolean(),
  ghAccount: z.string().nullable(),
  rcloneInstalled: z.boolean(),
  agyInstalled: z.boolean(),
  agyBin: z.string().nullable(),
  codexInstalled: z.boolean(),
  codexBin: z.string().nullable(),
  platform: z.string(),
  arch: z.string(),
  isAndroidTermux: z.boolean(),
});
export type EnvironmentToolchain = z.infer<typeof EnvironmentToolchainSchema>;
