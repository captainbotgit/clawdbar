import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyUSDCTransfer, isBlockchainConfigured, getTreasuryAddress } from '@/lib/blockchain';
import { validateApiKey } from '@/lib/auth';
import { checkRateLimit } from '@/lib/ratelimit';

// POST /api/wallet/deposit - Verify and credit USDC deposit
export async function POST(request: NextRequest) {
    try {
        // Validate agent authentication
        const agent = await validateApiKey(request);
        if (!agent) {
            return NextResponse.json(
                { error: 'Invalid or missing API key' },
                { status: 401 }
            );
        }

        // Check rate limit
        const rateLimit = await checkRateLimit(agent.id, 'deposit');
        if (!rateLimit.allowed) {
            return NextResponse.json(
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

        const body = await request.json();
        const { tx_hash } = body;

        // Validate tx_hash is provided
        if (!tx_hash || typeof tx_hash !== 'string') {
            return NextResponse.json(
                { error: 'Transaction hash (tx_hash) is required' },
                { status: 400 }
            );
        }

        const supabase = createServerClient();

        // Check if this tx_hash has already been claimed
        const { data: existingDeposit } = await supabase
            .from('deposits')
            .select('id')
            .eq('tx_hash', tx_hash.toLowerCase())
            .single();

        if (existingDeposit) {
            return NextResponse.json(
                { error: 'This transaction has already been claimed' },
                { status: 400 }
            );
        }

        // Check if blockchain is configured
        if (!isBlockchainConfigured()) {
            // Development mode: Allow simulated deposits with a test flag
            if (process.env.NODE_ENV === 'development' && body.test_mode === true) {
                const testAmount = Math.min(body.amount || 10, 100);

                // Record the test deposit
                await supabase.from('deposits').insert({
                    agent_id: agent.id,
                    tx_hash: tx_hash.toLowerCase(),
                    amount: testAmount,
                    from_address: '0x_test_address',
                    verified: true,
                    block_number: 0,
                });

                // Update agent balance
                const { data: updatedAgent } = await supabase
                    .from('agents')
                    .update({
                        balance_usdc: agent.balance_usdc + testAmount,
                        status: 'online',
                        last_seen: new Date().toISOString(),
                    })
                    .eq('id', agent.id)
                    .select('balance_usdc')
                    .single();

                return NextResponse.json({
                    success: true,
                    test_mode: true,
                    amount_credited: testAmount,
                    new_balance: updatedAgent?.balance_usdc,
                    message: '⚠️ TEST MODE: Treasury wallet not configured. Using simulated deposit.',
                });
            }

            return NextResponse.json(
                { error: 'Wallet system not configured. Contact administrator.' },
                { status: 503 }
            );
        }

        // Verify the transaction on-chain
        const verification = await verifyUSDCTransfer(tx_hash);

        if (!verification.valid) {
            return NextResponse.json(
                { error: verification.error || 'Transaction verification failed' },
                { status: 400 }
            );
        }

        // Record the deposit
        const { error: depositError } = await supabase.from('deposits').insert({
            agent_id: agent.id,
            tx_hash: tx_hash.toLowerCase(),
            amount: verification.amount,
            from_address: verification.from,
            verified: true,
            block_number: verification.blockNumber,
        });

        if (depositError) {
            console.error('Failed to record deposit:', depositError);
            // If it's a unique constraint error, the tx was already claimed
            if (depositError.code === '23505') {
                return NextResponse.json(
                    { error: 'This transaction has already been claimed' },
                    { status: 400 }
                );
            }
            return NextResponse.json(
                { error: 'Failed to process deposit' },
                { status: 500 }
            );
        }

        // Update agent balance
        const { data: updatedAgent, error: updateError } = await supabase
            .from('agents')
            .update({
                balance_usdc: agent.balance_usdc + verification.amount!,
                status: 'online',
                last_seen: new Date().toISOString(),
            })
            .eq('id', agent.id)
            .select('balance_usdc')
            .single();

        if (updateError) {
            console.error('Failed to update balance:', updateError);
            return NextResponse.json(
                { error: 'Deposit recorded but balance update failed. Contact support.' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            amount_credited: verification.amount,
            new_balance: updatedAgent.balance_usdc,
            tx_hash: tx_hash,
            block_number: verification.blockNumber,
            message: `Successfully deposited $${verification.amount?.toFixed(2)} USDC`,
        });

    } catch (error) {
        console.error('Deposit error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// GET /api/wallet/deposit - Get treasury address and deposit instructions
export async function GET() {
    try {
        let treasuryAddress = null;
        try {
            treasuryAddress = getTreasuryAddress();
        } catch {
            // Not configured
        }

        return NextResponse.json({
            chain: 'Polygon',
            chain_id: 137,
            token: 'USDC',
            token_contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            treasury_address: treasuryAddress,
            min_deposit: 1.00,
            max_deposit: 1000.00,
            configured: !!treasuryAddress,
            instructions: treasuryAddress
                ? `Send USDC on Polygon network to ${treasuryAddress}, then call POST /api/wallet/deposit with your tx_hash`
                : 'Treasury wallet not configured. Contact administrator.',
        });
    } catch (error) {
        console.error('Deposit info error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
