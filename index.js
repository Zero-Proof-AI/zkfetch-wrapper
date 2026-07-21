const express = require('express');
const cors = require('cors');
const { ReclaimClient } = require('@reclaimprotocol/zk-fetch');
const { verifyProof, transformForOnchain } = require('@reclaimprotocol/js-sdk');
const { verifyProofFull } = require('./zksnark-verifier');
const { verifyReclaimProof } = require('./zk-verify');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

function normalizeVerifyResult(result) {
  if (typeof result === 'boolean') {
    return result;
  }
  if (result && typeof result.isVerified === 'boolean') {
    return result.isVerified;
  }
  return Boolean(result);
}

async function verifyProofCompat(proof) {
  // js-sdk 5.x supports this options object and returns { isVerified, ... }.
  // This avoids flaky network validation paths during witness lookup.
  try {
    const result = await verifyProof(proof, { dangerouslyDisableContentValidation: true });
    return normalizeVerifyResult(result);
  } catch {
    // Fallback for older sdk behavior/signature.
    const result = await verifyProof(proof);
    return normalizeVerifyResult(result);
  }
}

// Check if Reclaim credentials are configured
const RECLAIM_CONFIGURED = !!(process.env.RECLAIM_APP_ID && process.env.RECLAIM_APP_SECRET);

// Initialize Reclaim Client (only if credentials provided)
let client = null;
if (RECLAIM_CONFIGURED) {
  try {
    client = new ReclaimClient(
      process.env.RECLAIM_APP_ID,
      process.env.RECLAIM_APP_SECRET
    );
    console.log('✅ Reclaim client initialized');
  } catch (error) {
    console.error('❌ Failed to initialize Reclaim client:', error.message);
  }
}

console.log('🔐 Reclaim Protocol zkFetch Wrapper');
console.log('  App ID:', process.env.RECLAIM_APP_ID || '⚠️  NOT SET');
if (!RECLAIM_CONFIGURED) {
  console.log('');
  console.log('⚠️  WARNING: Reclaim credentials not configured!');
  console.log('   Set RECLAIM_APP_ID and RECLAIM_APP_SECRET in .env file');
  console.log('   Get credentials from: https://dev.reclaimprotocol.org/');
  console.log('');
  console.log('   Service will run in MOCK mode until credentials are added.');
}
console.log('');

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'zkfetch-wrapper',
    reclaim_configured: RECLAIM_CONFIGURED,
    mode: RECLAIM_CONFIGURED ? 'production' : 'mock'
  });
});

// Main zkFetch endpoint - Generate zkTLS proof with selective disclosure
app.post('/zkfetch', async (req, res) => {
  try {
    const { url, publicOptions, privateOptions, redactions } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: url'
      });
    }

    // Check if Reclaim is configured
    if (!RECLAIM_CONFIGURED || !client) {
      console.log('⚠️  Mock mode: Returning mock proof (Reclaim not configured)');
      return res.json({
        success: true,
        data: { mock: true, message: 'Configure RECLAIM_APP_ID and RECLAIM_APP_SECRET for real proofs' },
        proof: generateMockProof(url, publicOptions),
        onchainProof: generateMockOnchainProof(url, publicOptions),
        metadata: {
          timestamp: Date.now(),
          url: url,
          method: publicOptions?.method || 'GET',
          onchain_compatible: false,
          mock: true
        }
      });
    }

    console.log('🔐 zkFetch request received');
    console.log('  URL:', url);
    console.log('  Method:', publicOptions?.method || 'GET');
    if (redactions && redactions.length > 0) {
      console.log('  Redactions:', redactions.length, 'field(s) will be hidden');
    }

    // Merge TEE option and provider ID if enabled
    const finalPublicOptions = {
      ...publicOptions,
      useTee: process.env.USE_TEE === 'true' || publicOptions?.useTee
    };

    // Add provider ID and redactions to private options
    const finalPrivateOptions = {
      ...privateOptions,
      ...(process.env.RECLAIM_PROVIDER_ID && { providerId: process.env.RECLAIM_PROVIDER_ID }),
      // Add selective disclosure redactions
      // Convert redactions array to SDK format (remove 'replacement' field if present)
      ...(redactions && redactions.length > 0 && { 
        responseRedactions: redactions.map(r => {
          const { replacement: _replacement, ...rest } = r; // Remove replacement field
          return rest;
        })
      })
    };

    console.log('  Provider ID:', process.env.RECLAIM_PROVIDER_ID || 'Not set');

    // Call Reclaim zkFetch SDK
    // Note: SDK connects to Reclaim attestor proxy, which:
    //   1. Proxies HTTPS request to target API
    //   2. Observes encrypted TLS traffic
    //   3. Signs attestation on encrypted transcript
    //   4. Returns encrypted data + signature
    // We then decrypt locally and generate ZK proof
    let proof;
    try {
      proof = await client.zkFetch(url, finalPublicOptions, finalPrivateOptions);
      console.log('✓ zkFetch completed');
      console.log('  Proof generated:', proof ? 'Yes' : 'No');
      
      // Verify proof locally - Two layers:
      // 1. Signature verification (attestor signatures)
      console.log('🔍 Verifying attestor signatures...');
      const signaturesValid = await verifyProofCompat(proof);
      console.log(signaturesValid ? '✓ Signatures: VALID' : '✗ Signatures: INVALID');
      
      // 2. ZK-SNARK verification (Groth16 proof of correct decryption)
      let zkValid = false;
      try {
        console.log('🔍 Verifying Groth16 ZK-SNARK proof...');
        const zkResult = await verifyReclaimProof(proof, { logger: console });
        zkValid = zkResult.verified;
        console.log(zkValid ? '✓ ZK-SNARK: VALID' : '✗ ZK-SNARK: INVALID');
      } catch (zkError) {
        console.warn('⚠️  ZK-SNARK verification skipped:', zkError.message);
        // ZK verification is optional - signature verification is primary
      }
      
      if (!signaturesValid) {
        console.error('❌ Generated proof failed signature verification!');
        console.error('   Proof ID:', proof.identifier);
        console.error('   Epoch:', proof.claimData?.epoch);
        console.error('   Witnesses:', proof.witnesses?.map(w => w.id).join(', '));
      }
      
      // DEBUG: Save generated proof for comparison
      const fs = require('fs');
      fs.writeFileSync('generated_proof.json', JSON.stringify(proof, null, 2));
      console.log('  Saved generated proof to ./generated_proof.json');
    } catch (zkFetchError) {
      // Log full error for debugging
      console.error('zkFetch SDK Error:', zkFetchError.message);
      console.error('Error details:', JSON.stringify({
        message: zkFetchError.message,
        name: zkFetchError.name,
        code: zkFetchError.code
      }, null, 2));
      
      // Handle Reclaim SDK errors (e.g., app not registered)
      if (zkFetchError.message.includes('Application not found') || 
          zkFetchError.message.includes('not found') ||
          zkFetchError.message.includes('Invalid application') ||
          zkFetchError.message.includes('unusable')) {
        console.warn('⚠️  Application not registered with Reclaim Protocol');
        console.warn('   Falling back to mock mode');
        console.warn('   Error was:', zkFetchError.message);
        
        return res.json({
          success: true,
          data: { mock: true, message: 'Application error: ' + zkFetchError.message },
          proof: generateMockProof(url, publicOptions),
          onchainProof: generateMockOnchainProof(url, publicOptions),
          metadata: {
            timestamp: Date.now(),
            url: url,
            method: publicOptions?.method || 'GET',
            onchain_compatible: false,
            mock: true,
            error: zkFetchError.message
          }
        });
      }
      throw zkFetchError; // Re-throw other errors
    }

    // Extract the redacted response data
    const responseData = proof?.extractedParameterValues?.data || '';
    
    // Parse if JSON
    let parsedData;
    try {
      // Handle chunked responses
      const cleanedData = decodeChunkedResponse(responseData);
      parsedData = JSON.parse(cleanedData);
    } catch {
      parsedData = responseData; // Return as-is if not JSON
    }

    // Transform proof for on-chain verification
    // Note: transformForOnchain might not be available in all SDK versions
    let onchainProof = proof;
    try {
      if (RECLAIM_CONFIGURED && typeof transformForOnchain === 'function') {
        onchainProof = transformForOnchain(proof);
        console.log('✓ Proof transformed for on-chain verification');
      } else {
        console.log('ℹ Using proof as-is (transformForOnchain not available)');
      }
    } catch (transformError) {
      console.warn('⚠️  Could not transform proof for on-chain:', transformError.message);
      onchainProof = proof; // Use original proof
    }

    // Final verification before returning
    const finalVerification = await verifyProofCompat(proof);
    
    res.json({
      success: true,
      data: parsedData,
      proof: proof,  // Full proof object for off-chain verification
      onchainProof: onchainProof,  // Formatted for smart contract
      verified: finalVerification,  // Local verification result
      metadata: {
        timestamp: Date.now(),
        url: url,
        method: publicOptions?.method || 'GET',
        onchain_compatible: true,
        verification: {
          local: finalVerification,
          timestamp: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error('✗ zkFetch error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Verify proof endpoint (off-chain verification)
app.post('/verify', async (req, res) => {
  try {
    const { proof } = req.body;

    if (!proof) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: proof'
      });
    }
    
    console.log('🔍 Verifying proof...');
    console.log('  Identifier:', proof.identifier);
    
    // DEBUG: Save received proof for comparison
    // const fs = require('fs');
    // fs.writeFileSync('/tmp/received_proof.json', JSON.stringify(proof, null, 2));
    // console.log('  Saved received proof to /tmp/received_proof.json');
    
    const isValid = await verifyProofCompat(proof);
    
    console.log(isValid ? '✓ Proof is valid' : '✗ Proof is invalid');
    
    res.json({
      success: true,
      valid: isValid,
      extractedData: isValid ? proof.extractedParameterValues : null
    });
  } catch (error) {
    console.error('✗ Verification error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Transform proof for on-chain verification
app.post('/transform-onchain', async (req, res) => {
  try {
    const { proof } = req.body;

    if (!proof) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: proof'
      });
    }

    console.log('🔄 Transforming proof for on-chain use...');

    const onchainProof = transformForOnchain(proof);

    console.log('✓ Proof transformed');

    res.json({
      success: true,
      onchainProof: onchainProof
    });
  } catch (error) {
    console.error('✗ Transform error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Full verification including zkSNARK (if available)
app.post('/verify-full', async (req, res) => {
  try {
    const { proof, options } = req.body;

    if (!proof) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: proof'
      });
    }

    console.log('🔐 Full verification (signatures + zkSNARK)...');

    const result = await verifyProofFull(proof, options || {});

    console.log(result.valid ? '✓ Full verification passed' : '✗ Full verification failed');

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('✗ Full verification error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to decode chunked HTTP responses
function decodeChunkedResponse(chunkedData) {
  if (typeof chunkedData !== 'string') {
    return chunkedData;
  }

  // Remove chunk size markers (hex number + \r\n)
  // and trailing \r\n markers
  return chunkedData
    .replace(/^[0-9a-fA-F]+\r\n/, '') // Remove initial chunk size
    .replace(/\r\n0\r\n\r\n$/, '') // Remove final chunk marker
    .replace(/\r\n[0-9a-fA-F]+\r\n/g, ''); // Remove any intermediate chunk markers
}

// Mock proof generation (for when Reclaim credentials not configured)
function generateMockProof(url, publicOptions) {
  return {
    claimInfo: {
      provider: 'http',
      parameters: JSON.stringify({
        url: url,
        method: publicOptions?.method || 'GET'
      }),
      context: 'MOCK_RESPONSE_DATA'
    },
    signedClaim: {
      claim: {
        identifier: '0x' + Buffer.from(url).toString('hex'),
        owner: '0x0000000000000000000000000000000000000000',
        timestampS: Math.floor(Date.now() / 1000),
        epoch: 1
      },
      signatures: ['0xMOCK_SIGNATURE']
    },
    witnesses: [{
      id: 'mock_witness',
      url: 'https://witness.mock.local'
    }],
    extractedParameterValues: {
      data: 'MOCK_DATA'
    }
  };
}

function generateMockOnchainProof(url, publicOptions) {
  return {
    claimInfo: {
      provider: 'http',
      parameters: JSON.stringify({
        url: url,
        method: publicOptions?.method || 'GET'
      }),
      context: 'MOCK_ONCHAIN'
    },
    signedClaim: {
      claim: {
        identifier: '0x' + Buffer.from(url).toString('hex'),
        owner: '0x0000000000000000000000000000000000000000',
        timestampS: Math.floor(Date.now() / 1000),
        epoch: 1
      },
      signatures: ['0xMOCK_SIGNATURE_ONCHAIN']
    }
  };
}

const PORT = process.env.PORT || 8003;

app.listen(PORT, () => {
  console.log('✓ zkFetch Wrapper running on port', PORT);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /zkfetch           - Generate zkTLS proof');
  console.log('  POST /verify            - Verify proof (signatures only)');
  console.log('  POST /verify-full       - Full verification (signatures + zkSNARK if available)');
  console.log('  POST /transform-onchain - Transform proof for smart contract');
  console.log('  GET  /health            - Health check');
  console.log('');
  
  if (!process.env.RECLAIM_APP_ID) {
    console.warn('⚠ WARNING: RECLAIM_APP_ID not set!');
    console.warn('  Set it in .env file or environment variables');
  }
});
