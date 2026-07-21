const { generateProof } = require('./generate-proof');
const { verifyProofForTests } = require('./verify-proof');
const fs = require('fs');

async function detailedVerification() {
    // Generate fresh proof first
    await generateProof();
    
    // Read the generated proof
    const proof = JSON.parse(fs.readFileSync('proof-structure.json', 'utf8'));
    
    console.log('='.repeat(70));
    console.log('  DETAILED VERIFICATION TEST');
    console.log('='.repeat(70));
    
    console.log('\n📋 Proof Details:');
    console.log('  Identifier:', proof.identifier);
    console.log('  Epoch:', proof.claimData.epoch);
    console.log('  Timestamp:', proof.claimData.timestampS);
    console.log('  Witness (metadata):', proof.witnesses[0].id);
    console.log('');
    
    console.log('📋 Calling SDK verifyProof...');
    
    try {
        const isValid = await verifyProofForTests(proof, { timeoutMs: 60000 });
        console.log('\n✅ SDK Verification Result:', isValid);
        
        if (isValid) {
            console.log('\n🎉 SUCCESS! The SDK verified the proof locally!');
            console.log('\nThis means:');
            console.log('1. ✅ ECDSA signatures verified (locally)');
            console.log('   - Recovered signer from attestor signatures');
            console.log('   - Verified signatures match expected witnesses');
            console.log('2. ✅ Proof structure and integrity validated');
            console.log('3. 🔒 ZK proof was already verified by attestor (before signing)');
            console.log('   - Attestor used attestor-core to verify Groth16 zkSNARK');
            console.log('   - Attestor only signs if ZK proof is valid');
            console.log('   - js-sdk trusts attestor\'s verification (checks ECDSA only)');
            console.log('\nVerification Flow:');
            console.log('  Client → Generates ZK proof (Groth16, local)');
            console.log('  Attestor → Verifies ZK proof (attestor-core)');
            console.log('  Attestor → Signs claim (ECDSA) if ZK valid');
            console.log('  js-sdk → Verifies ECDSA signatures (trusts attestor)');
            console.log('\nConclusion: Off-chain ECDSA signature verification works!');
            console.log('Note: This does NOT verify against blockchain contracts.');
            console.log('      On-chain verification also checks ONLY ECDSA signatures.');
            console.log('\n' + '='.repeat(70));
            process.exit(0);
        } else {
            console.log('\n❌ Verification failed');
            console.log('\n' + '='.repeat(70));
            process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error('Stack:', error.stack);
        console.log('\n' + '='.repeat(70));
        process.exit(1);
    }
}

detailedVerification();
