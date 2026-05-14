// Persistent state stored in Script Properties.
//   seenIds : array of deal ids we've ever pushed (FIFO-trimmed)
//   topDeals: ordered array of the current top-N deals shown in the sheet

function loadState() {
  var props = PropertiesService.getScriptProperties();
  var seen = JSON.parse(props.getProperty(CONFIG.STATE_KEY_SEEN) || '[]');
  var top = JSON.parse(props.getProperty(CONFIG.STATE_KEY_TOP) || '[]');
  return { seenIds: seen, topDeals: top };
}

function saveState(state) {
  // Trim seenIds FIFO to keep the property under quota.
  if (state.seenIds.length > CONFIG.SEEN_CAP) {
    state.seenIds = state.seenIds.slice(state.seenIds.length - CONFIG.SEEN_CAP);
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty(CONFIG.STATE_KEY_SEEN, JSON.stringify(state.seenIds));
  props.setProperty(CONFIG.STATE_KEY_TOP, JSON.stringify(state.topDeals));
}

function clearState() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(CONFIG.STATE_KEY_SEEN);
  props.deleteProperty(CONFIG.STATE_KEY_TOP);
}
