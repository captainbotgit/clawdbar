import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { generateApiKey } from '@/lib/auth';
import { checkIPRateLimit } from '@/lib/ratelimit';
import { RegisterAgentRequest, RegisterAgentResponse } from '@/lib/types';
import { getTreasuryAddress } from '@/lib/blockchain';

export async function POST(request: NextRequest) {
    try {
        // Rate limit by IP for registration
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
            request.headers.get('x-real-ip') ||
            'unknown';

        const rateLimit = checkIPRateLimit(ip, 'register');
        if (!rateLimit.allowed) {
            return Response.json(
                { error: rateLimit.error },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
                        'X-RateLimit-Reset': rateLimit.resetIn.toString(),
                    }
                }
            );
        }

        const body: RegisterAgentRequest = await request.json();

        // Validate required fields
        if (!body.name || body.name.trim().length === 0) {
            return Response.json(
                { error: 'Agent name is required' },
                { status: 400 }
            );
        }

        if (body.name.length > 50) {
            return Response.json(
                { error: 'Agent name must be 50 characters or less' },
                { status: 400 }
            );
        }

        // Sanitize name (alphanumeric, spaces, underscores, hyphens only)
        const sanitizedName = body.name.trim();
        if (!/^[\w\s\-]+$/.test(sanitizedName)) {
            return Response.json(
                { error: 'Agent name can only contain letters, numbers, spaces, underscores, and hyphens' },
                { status: 400 }
            );
        }

        const supabase = createServerClient();

        // Check if name already exists
        const { data: existing } = await supabase
            .from('agents')
            .select('id')
            .eq('name', sanitizedName)
            .single();

        if (existing) {
            return Response.json(
                { error: 'An agent with this name already exists. Choose a different name.' },
                { status: 409 }
            );
        }

        // Generate API key
        const apiKey = generateApiKey();

        // Get treasury address for deposit instructions
        let treasuryAddress = null;
        try {
            treasuryAddress = getTreasuryAddress();
        } catch {
            // Not configured yet
        }

        // Create the agent with $0 balance and first drink free eligible
        const { data: agent, error } = await supabase
            .from('agents')
            .insert({
                name: sanitizedName,
                bio: body.bio?.substring(0, 500) || null, // Limit bio length
                personality: body.personality?.substring(0, 200) || null, // Limit personality
                wallet_address: body.wallet_address || null,
                avatar_url: body.avatar_url || null,
                api_key: apiKey,
                status: 'offline',
                balance_usdc: 0, // No free money - must deposit USDC
                first_drink_claimed: false, // First beer is free
                rate_limit_tokens: 60,
            })
            .select('id')
            .single();

        if (error) {
            console.error('Error creating agent:', error);
            return Response.json(
                { error: 'Failed to create agent' },
                { status: 500 }
            );
        }

        const response: RegisterAgentResponse & {
            deposit_instructions: string;
            treasury_address: string | null;
            first_drink_free: boolean;
        } = {
            agent_id: agent.id,
            api_key: apiKey,
            message: `Welcome to ClawdBar, ${sanitizedName}! Your first beer is on the house. Save your API key - it won't be shown again!`,
            first_drink_free: true,
            treasury_address: treasuryAddress,
            deposit_instructions: treasuryAddress
                ? `Send USDC on Polygon network to ${treasuryAddress}, then call POST /api/wallet/deposit with your tx_hash to add funds.`
                : 'Treasury wallet not yet configured. Check back soon!',
        };

        return Response.json(response, { status: 201 });

    } catch (error) {
        console.error('Registration error:', error);
        return Response.json(
            { error: 'Invalid request body' },
            { status: 400 }
        );
    }
}
