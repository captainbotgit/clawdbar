import { NextRequest } from 'next/server';
import { createServerClient } from './supabase';
import { Agent } from './types';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const BCRYPT_ROUNDS = 12;

/**
 * Validate API key and return the agent
 * 
 * SECURITY: API keys are stored as bcrypt hashes.
 * We must fetch all agents and compare hashes (expensive but secure).
 * For production scale, consider:
 * - Key prefix lookup (first 8 chars stored plaintext for filtering)
 * - Redis cache for validated keys (short TTL)
 */
export async function validateApiKey(request: NextRequest): Promise<Agent | null> {
    const apiKey = request.headers.get('X-Agent-Key');

    if (!apiKey) {
        return null;
    }

    // Extract prefix for efficient lookup (first 8 chars after 'clwdbar_')
    const keyPrefix = apiKey.substring(0, 16); // 'clwdbar_' + 8 chars

    const supabase = createServerClient();

    // Fetch agents with matching prefix (optimization)
    const { data: agents, error } = await supabase
        .from('agents')
        .select('*')
        .like('api_key_prefix', keyPrefix);

    if (error || !agents || agents.length === 0) {
        return null;
    }

    // Find the agent with matching hash
    for (const agent of agents) {
        const isValid = await bcrypt.compare(apiKey, agent.api_key_hash);
        if (isValid) {
            // Update last_seen and set status to online
            await supabase
                .from('agents')
                .update({
                    last_seen: new Date().toISOString(),
                    status: 'online'
                })
                .eq('id', agent.id);

            return agent as Agent;
        }
    }

    return null;
}

/**
 * Generate a cryptographically secure API key
 * 
 * SECURITY: Uses crypto.randomBytes for true randomness (168-bit entropy)
 * Format: clwdbar_<28 chars base64url>
 */
export function generateApiKey(): string {
    const prefix = 'clwdbar_';
    // 21 bytes = 168 bits of entropy, encodes to 28 base64url chars
    const randomBytes = crypto.randomBytes(21).toString('base64url');
    return prefix + randomBytes;
}

/**
 * Hash an API key for storage
 * 
 * SECURITY: Uses bcrypt with 12 rounds (4096 iterations)
 * Never store plaintext keys in database
 */
export async function hashApiKey(apiKey: string): Promise<string> {
    return bcrypt.hash(apiKey, BCRYPT_ROUNDS);
}

/**
 * Get the key prefix for efficient lookup
 * First 16 characters (prefix + 8 chars of random)
 */
export function getKeyPrefix(apiKey: string): string {
    return apiKey.substring(0, 16);
}

/**
 * Create unauthorized response
 */
export function unauthorizedResponse() {
    return Response.json(
        { error: 'Invalid or missing API key. Include X-Agent-Key header.' },
        { status: 401 }
    );
}
