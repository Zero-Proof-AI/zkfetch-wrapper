const { verifyProof } = require('@reclaimprotocol/js-sdk');

function withTimeout(promise, timeoutMs, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
}

async function verifyProofForTests(proof, options = {}) {
    const timeoutMs = options.timeoutMs || 60000;

    // js-sdk 5.x returns an object: { isVerified, data, publicData }.
    const result = await withTimeout(
        verifyProof(proof, { dangerouslyDisableContentValidation: true }),
        timeoutMs,
        'verifyProof'
    );

    if (typeof result === 'boolean') {
        return result;
    }

    if (result && typeof result.isVerified === 'boolean') {
        return result.isVerified;
    }

    return Boolean(result);
}

module.exports = {
    verifyProofForTests,
};
