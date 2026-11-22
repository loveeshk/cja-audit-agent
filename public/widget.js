// widget.js — drop this + widget.css into any site.
// Usage: <script src="/widget.js" data-api-url="http://localhost:3000/api/chat"></script>

(function () {
  const scriptTag = document.currentScript;
  const apiUrl = scriptTag?.dataset?.apiUrl || '/api/chat';

  const state = { messages: [], open: false, sending: false };

  // --- Build DOM ---
  const launcher = document.createElement('button');
  launcher.className = 'sw-launcher';
  launcher.setAttribute('aria-label', 'Open support chat');
  launcher.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5c-1.4 0-2.73-.33-3.9-.92L3 21l1.92-5.6A8.38 8.38 0 0 1 3.5 11.5 8.38 8.38 0 0 1 12 3a8.38 8.38 0 0 1 9 8.5z"/>
  </svg>`;

  const panel = document.createElement('div');
  panel.className = 'sw-panel';
  panel.innerHTML = `
    <div class="sw-header">
      <div>
        <div class="sw-header-title">Support</div>
        <div class="sw-header-sub">Usually replies in a few seconds</div>
      </div>
      <button class="sw-close" aria-label="Close chat">&times;</button>
    </div>
    <div class="sw-messages"></div>
    <div class="sw-inputrow">
      <textarea class="sw-input" rows="1" placeholder="Type a message..."></textarea>
      <button class="sw-send" aria-label="Send">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>
        </svg>
      </button>
    </div>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector('.sw-messages');
  const inputEl = panel.querySelector('.sw-input');
  const sendBtn = panel.querySelector('.sw-send');
  const closeBtn = panel.querySelector('.sw-close');

  // --- Greeting ---
  addBotMessage("Hi! What can I help you with today?");

  // --- Open/close ---
  launcher.addEventListener('click', () => togglePanel(true));
  closeBtn.addEventListener('click', () => togglePanel(false));

  function togglePanel(open) {
    state.open = open;
    panel.classList.toggle('sw-open', open);
    if (open) inputEl.focus();
  }

  // --- Sending ---
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || state.sending) return;

    addUserMessage(text);
    state.messages.push({ role: 'user', content: text });
    inputEl.value = '';
    inputEl.style.height = 'auto';

    state.sending = true;
    sendBtn.disabled = true;
    const typingEl = addBotMessage('...', true);

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: state.messages }),
      });
      if (res.status === 401) {
        typingEl.remove();
        addBotMessage("Your session expired. Redirecting you to sign in...");
        setTimeout(() => { window.location.href = '/auth/login'; }, 1200);
        return;
      }

      const data = await res.json();
      typingEl.remove();

      if (!res.ok) throw new Error(data.error || 'Request failed');

      addBotMessage(data.reply);
      state.messages.push({ role: 'assistant', content: data.reply });
    } catch (err) {
      typingEl.remove();
      addBotMessage("Sorry, something went wrong. Please try again in a moment.");
      console.error(err);
    } finally {
      state.sending = false;
      sendBtn.disabled = false;
    }
  }

  function addUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'sw-msg sw-msg-user';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function addBotMessage(text, typing = false) {
    const el = document.createElement('div');
    el.className = 'sw-msg sw-msg-bot' + (typing ? ' sw-msg-typing' : '');
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
})();
