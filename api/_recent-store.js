const RECENT_KEY = "__MMA_RECENT_GENERATIONS__";

function getStore() {
  if (!globalThis[RECENT_KEY]) {
    globalThis[RECENT_KEY] = [];
  }

  return globalThis[RECENT_KEY];
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function addRecentGeneration(item) {
  const store = getStore();

  const record = {
    id: item.id || makeId(),
    imageUrl: item.imageUrl || item.image || "",
    prompt: item.prompt || "",
    createdAt: item.createdAt || new Date().toISOString(),
    wikiLinks: item.wikiLinks || [],
    primaryWikiLink: item.primaryWikiLink || null,
  };

  if (!record.imageUrl) {
    return null;
  }

  const updated = [record, ...store].slice(0, 10);

  globalThis[RECENT_KEY] = updated;

  return record;
}

export function getRecentGenerations() {
  return getStore().slice(0, 10);
}
