// Background script for WPML AI Translation Extension
// Currently minimal - could be expanded for additional functionality

chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Translation Extension installed');
});

// Optional: Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // This will open the popup automatically due to default_popup in manifest
  console.log('Extension icon clicked');
});
