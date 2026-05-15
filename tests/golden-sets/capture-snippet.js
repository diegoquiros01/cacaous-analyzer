// ═══════════════════════════════════════════════════════════════
// PASTE THIS IN THE BROWSER CONSOLE AFTER A VALIDATION COMPLETES
// It copies the full analysis results to your clipboard as JSON.
// Then save it to: tests/golden-sets/results/<set-id>-run.json
// ═══════════════════════════════════════════════════════════════

(function captureDocsValidateResults() {
  if (typeof analysisResults === 'undefined' || !analysisResults) {
    console.error('❌ No analysisResults found. Run a validation first.');
    return;
  }

  const output = {
    _capturedAt: new Date().toISOString(),
    _url: window.location.href,
    analysisResults: analysisResults,
    coherenceResult: typeof coherenceResult !== 'undefined' ? coherenceResult : null,
  };

  const json = JSON.stringify(output, null, 2);

  // Copy to clipboard
  navigator.clipboard.writeText(json).then(() => {
    console.log('✅ Results copied to clipboard!');
    console.log(`   Documents: ${Object.keys(analysisResults).length} files`);
    console.log(`   Coherence issues: ${output.coherenceResult?.coherenceIssues?.length || 0}`);
    console.log('');
    console.log('📋 Now save to: tests/golden-sets/results/<set-id>-run.json');
  }).catch(() => {
    // Fallback: log to console for manual copy
    console.log('Clipboard failed. Copy the JSON below:');
    console.log(json);
  });
})();
