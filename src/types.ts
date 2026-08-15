export interface User {
  id: string;
  name: string;
  color: string;
  joinedAt: Date;
}

export interface Document {
  id: string;
  name: string;
  content: string;
  ownerId: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CursorPosition {
  userId: string;
  userName: string;
  line: number;
  column: number;
  color: string;
}

export interface Operation {
  type: 'insert' | 'delete' | 'retain';
  pos: number;
  text?: string;
  length?: number;
}

export interface SyncMessage {
  docId: string;
  userId: string;
  operation: Operation;
  revision: number;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: Date;
  roomId: string;
}

export interface Room {
  id: string;
  name: string;
  docId: string;
  users: User[];
  createdAt: Date;
}

export interface Terminal {
  id: string;
  roomId: string;
  userId: string;
  sessionId: string;
}

export interface AICursorSuggestion {
  id: string;
  startLine: number;
  endLine: number;
  suggestion: string;
  confidence: number;
  model: string;
  createdAt: Date;
}

export enum RoomEvent {
  USER_JOIN = 'user:join',
  USER_LEAVE = 'user:leave',
  CURSOR_UPDATE = 'cursor:update',
  OPERATION = 'operation',
  CHAT_MESSAGE = 'chat:message',
  AI_SUGGESTION = 'ai:suggestion',
  DOC_SYNC = 'doc:sync',
  RTC_OFFER = 'rtc:offer',
  RTC_ANSWER = 'rtc:answer',
  RTC_ICE = 'rtc:ice',
}

export enum WSEvent {
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  ERROR = 'error',
}
