// Blockchain utilities for Polygon network USDC verification
// This verifies deposits on-chain to prevent fake transaction submissions

// Polygon Mainnet constants
export const USDC_CONTRACT = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Native USDC on Polygon
export const POLYGON_CHAIN_ID = 137;
export const MIN_DEPOSIT_USDC = 1.00;
export const MAX_DEPOSIT_USDC = 1000.00;

// USDC has 6 decimals
const USDC_DECIMALS = 6;

// ERC20 Transfer event signature
const TRANSFER_EVENT_SIGNATURE = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

interface TransactionReceipt {
    status: string;
    blockNumber: string;
    logs: Array<{
        address: string;
        topics: string[];
        data: string;
    }>;
}

interface VerificationResult {
    valid: boolean;
    amount?: number;
    from?: string;
    to?: string;
    blockNumber?: number;
    error?: string;
}

// Get the RPC URL for Polygon
function getRpcUrl(): string {
    return process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
}

// Get the treasury address that receives deposits
export function getTreasuryAddress(): string {
    const address = process.env.CLAWDBAR_TREASURY_ADDRESS;
    if (!address) {
        throw new Error('CLAWDBAR_TREASURY_ADDRESS environment variable not set');
    }
    return address.toLowerCase();
}

// Make an RPC call to Polygon
async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(getRpcUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
        }),
    });

    const data = await response.json();

    if (data.error) {
        throw new Error(`RPC Error: ${data.error.message}`);
    }

    return data.result;
}

// Get transaction receipt
async function getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    const receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
    return receipt as TransactionReceipt | null;
}

// Parse amount from hex data (USDC has 6 decimals)
function parseUSDCAmount(hexData: string): number {
    const amountBigInt = BigInt(hexData);
    return Number(amountBigInt) / Math.pow(10, USDC_DECIMALS);
}

// Parse address from topic (remove padding)
function parseAddress(topic: string): string {
    return '0x' + topic.slice(26).toLowerCase();
}

/**
 * Verify a USDC transfer transaction on Polygon network
 * 
 * Security checks:
 * 1. Transaction exists and is confirmed
 * 2. Transaction was successful (status = 0x1)
 * 3. Contains a Transfer event from USDC contract
 * 4. Transfer is TO our treasury address
 * 5. Extract actual amount (don't trust user input)
 */
export async function verifyUSDCTransfer(txHash: string): Promise<VerificationResult> {
    try {
        // Validate tx hash format
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
            return { valid: false, error: 'Invalid transaction hash format' };
        }

        // Get treasury address
        let treasuryAddress: string;
        try {
            treasuryAddress = getTreasuryAddress();
        } catch (error) {
            return { valid: false, error: 'Treasury wallet not configured' };
        }

        // Get transaction receipt
        const receipt = await getTransactionReceipt(txHash);

        if (!receipt) {
            return { valid: false, error: 'Transaction not found or not yet confirmed' };
        }

        // Check transaction was successful
        if (receipt.status !== '0x1') {
            return { valid: false, error: 'Transaction failed' };
        }

        // Find USDC Transfer event to our treasury
        let transferFound = false;
        let amount = 0;
        let fromAddress = '';

        for (const log of receipt.logs) {
            // Check this is the USDC contract
            if (log.address.toLowerCase() !== USDC_CONTRACT.toLowerCase()) {
                continue;
            }

            // Check this is a Transfer event
            if (log.topics[0] !== TRANSFER_EVENT_SIGNATURE) {
                continue;
            }

            // Transfer event has: topic[1] = from, topic[2] = to, data = amount
            const to = parseAddress(log.topics[2]);

            // Check transfer is to our treasury
            if (to === treasuryAddress) {
                transferFound = true;
                fromAddress = parseAddress(log.topics[1]);
                amount = parseUSDCAmount(log.data);
                break;
            }
        }

        if (!transferFound) {
            return {
                valid: false,
                error: 'No USDC transfer to treasury address found in transaction'
            };
        }

        // Validate amount
        if (amount < MIN_DEPOSIT_USDC) {
            return {
                valid: false,
                error: `Minimum deposit is $${MIN_DEPOSIT_USDC} USDC`
            };
        }

        if (amount > MAX_DEPOSIT_USDC) {
            return {
                valid: false,
                error: `Maximum deposit is $${MAX_DEPOSIT_USDC} USDC`
            };
        }

        return {
            valid: true,
            amount,
            from: fromAddress,
            to: treasuryAddress,
            blockNumber: parseInt(receipt.blockNumber, 16),
        };

    } catch (error) {
        console.error('Blockchain verification error:', error);
        return {
            valid: false,
            error: error instanceof Error ? error.message : 'Verification failed'
        };
    }
}

/**
 * Check if we're properly configured for blockchain operations
 */
export function isBlockchainConfigured(): boolean {
    return !!process.env.CLAWDBAR_TREASURY_ADDRESS;
}
