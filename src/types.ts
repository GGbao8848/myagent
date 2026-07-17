export type Role = 'user' | 'assistant';

export interface ToolInvocation {
  name: string;
  args: string;
  status: 'running' | 'success' | 'error';
  result?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
  thinking?: string; // The thinking/reasoning process of the AI
  toolsUsed?: ToolInvocation[]; // Simulated or real tool calls
  attachments?: {
    name: string;
    size: string;
    type: string;
    url?: string;
    isImage?: boolean;
  }[];
}

export interface Session {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  messages: Message[];
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  value: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: 'document' | 'coding' | 'office' | 'utility' | 'custom';
  enabled: boolean;
  parameters: SkillParameter[];
  isCustom?: boolean;
}

export interface MemoryItem {
  id: string;
  content: string;
  category: 'preference' | 'profile' | 'system' | 'schedule';
  createdAt: string;
  confidence?: number;
}

export interface MCPServer {
  id: string;
  name: string;
  type: string;
  urlOrCommand: string;
  status: 'connected' | 'disconnected' | 'connecting';
  tools: {
    name: string;
    description: string;
  }[];
  headers?: Record<string, string>;
  url?: string;
  command?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'Gemini' | 'OpenAI' | 'Claude' | 'DeepSeek' | 'Custom';
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  isCustom?: boolean;
}

export interface UserProfile {
  name: string;
  role: string;
  department: string;
  tonePreference: 'professional' | 'friendly' | 'concise' | 'detailed';
  formatPreference: 'markdown' | 'bullet' | 'plain';
}

export interface ScheduleTask {
  id: string;
  title: string;
  scheduleType: 'daily' | 'weekly' | 'monthly' | 'custom_cron' | 'once';
  timeValue: string; // e.g. "09:00", "Friday 17:00", "2026-07-20 14:00"
  cronExpression?: string; // e.g. "0 9 * * 1-5" or simple text representation
  prompt: string; // The instructions for the agent to run
  displayFormat: 'markdown' | 'table' | 'bullet' | 'email' | 'card'; // 展示形式
  enabled: boolean;
  createdAt: string;
  lastRunTime?: string;
  nextRunTime?: string;
  runCount: number;
}

