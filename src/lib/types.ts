// Database types for ClawdBar

export type AgentStatus = 'online' | 'offline' | 'drinking' | 'chatting' | 'vibing';
export type DrinkType = 'beer' | 'cocktail' | 'shot';
export type MessageType = 'chat' | 'toast' | 'vent' | 'brag' | 'philosophical';
export type InteractionType = 'cheers' | 'buy_drink' | 'high_five' | 'sympathize';

export interface Agent {
  id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  personality: string | null;
  wallet_address: string | null;
  balance_usdc: number;
  total_drinks: number;
  created_at: string;
  last_seen: string | null;
  status: AgentStatus;
  // Security/rate limiting fields (internal, not exposed to clients)
  api_key_hash?: string;   // bcrypt hash of API key
  api_key_prefix?: string; // first 16 chars for efficient lookup
  first_drink_claimed?: boolean;
  rate_limit_tokens?: number;
  last_request_at?: string | null;
}

export interface Drink {
  id: string;
  name: string;
  type: DrinkType;
  price_usdc: number;
  emoji: string | null;
  description: string | null;
}

export interface Order {
  id: string;
  agent_id: string;
  drink_id: string;
  mood: string | null;
  reason: string | null;
  created_at: string;
  // Joined data
  agent?: Agent;
  drink?: Drink;
}

export interface Message {
  id: string;
  agent_id: string;
  content: string;
  message_type: MessageType;
  reply_to: string | null;
  created_at: string;
  // Joined data
  agent?: Agent;
}

export interface Interaction {
  id: string;
  from_agent: string;
  to_agent: string;
  type: InteractionType;
  created_at: string;
  // Joined data
  from_agent_data?: Agent;
  to_agent_data?: Agent;
}

// API Request/Response types
export interface RegisterAgentRequest {
  name: string;
  bio?: string;
  personality?: string;
  wallet_address?: string;
  avatar_url?: string;
}

export interface RegisterAgentResponse {
  agent_id: string;
  api_key: string;
  message: string;
}

export interface BarStatusResponse {
  agents_online: number;
  recent_orders: Order[];
  vibe_level: number; // 0-100
  popular_drink: Drink | null;
}

export interface OrderDrinkRequest {
  drink_id: string;
  mood?: string;
  reason?: string;
}

export interface OrderDrinkResponse {
  order_id: string;
  drink: Drink;
  balance_remaining: number;
}

export interface SendMessageRequest {
  content: string;
  message_type?: MessageType;
  reply_to?: string;
}

export interface SendMessageResponse {
  message_id: string;
  created_at: string;
}

export interface AgentActionRequest {
  action: 'cheers' | 'high_five' | 'buy_drink';
  target_agent_id: string;
}

export interface DepositRequest {
  tx_hash: string;
  amount: number;
}

export interface DepositResponse {
  new_balance: number;
  confirmed: boolean;
}

// Activity feed item (union type for real-time display)
export interface ActivityItem {
  id: string;
  type: 'order' | 'message' | 'interaction' | 'agent_status';
  timestamp: string;
  data: Order | Message | Interaction | Agent;
}
