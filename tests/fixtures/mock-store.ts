export function createMockStore() {
  const events: unknown[] = [];
  const messages: unknown[] = [];
  return {
    events, messages,
    appendEvent: (e: unknown) => { events.push(e); },
    appendMessage: (m: unknown) => { messages.push(m); },
    getState: () => ({ running: false, events, messages }),
  };
}
