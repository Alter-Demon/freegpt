(() => {
  const ROOT_ID = "twopane-root";
  const DONE_ATTR = "data-twopane-done";
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    }
    children.forEach(c => n.appendChild(c));
    return n;
  }

  function svgIcon(pathD) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", "tw-icon");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", pathD);
    s.appendChild(p);
    return s;
  }

  // Inject the interceptor script via web_accessible_resources (CSP-safe)
  function injectInterceptor() {
    if (document.getElementById('chatgpt-translator-injector')) return;
    
    const script = document.createElement('script');
    script.id = 'chatgpt-translator-injector';
    script.src = chrome.runtime.getURL('injector.js');
    script.onload = function() {
      console.log('[ChatGPT Translator] Injector script loaded');
    };
    script.onerror = function(e) {
      console.error('[ChatGPT Translator] Failed to load injector script:', e);
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // Inject interceptor as early as possible
  injectInterceptor();

  // Toast notification system
  function showToast(message, duration = 2000) {
    const existingToast = document.querySelector('.tw-toast');
    if (existingToast) existingToast.remove();
    
    const toast = el("div", { class: "tw-toast", text: message });
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('tw-show'), 10);
    
    setTimeout(() => {
      toast.classList.remove('tw-show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Find the translator container
  function findTranslatorRoot() {
    const candidates = $all("div").filter(d => {
      if (d.getAttribute(DONE_ATTR) === "1") return false;
      if (d.querySelector(`#${ROOT_ID}`)) return false;
      return d.querySelectorAll("textarea").length >= 2;
    });

    candidates.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);

    for (const c of candidates) {
      const tas = $all("textarea", c);
      const input = tas.find(t => !t.hasAttribute("readonly"));
      const output = tas.find(t => t.hasAttribute("readonly"));
      if (input && output) return c;
    }
    return null;
  }

  function setNativeValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(element, value);
    else element.value = value;
  }

  // Update the model in the page context via custom event
  function updateModel(modelValue) {
    window.dispatchEvent(new CustomEvent('chatgpt-translator-update-model', {
      detail: { model: modelValue }
    }));
    console.log('[ChatGPT Translator] Sent model update:', modelValue);
  }
  
  // Update the system prompt in the page context via custom event
  function updateSystemPrompt(prompt) {
    window.dispatchEvent(new CustomEvent('chatgpt-translator-update-system-prompt', {
      detail: { prompt: prompt }
    }));
    console.log('[ChatGPT Translator] Sent system prompt update');
  }
  
  // Update the developer prompt in the page context via custom event
  function updateDeveloperPrompt(prompt) {
    window.dispatchEvent(new CustomEvent('chatgpt-translator-update-developer-prompt', {
      detail: { prompt: prompt }
    }));
    console.log('[ChatGPT Translator] Sent developer prompt update');
  }

  function buildChatUI({ translatorRoot, inputTextarea, outputTextarea }) {
    // Hide original textareas
    inputTextarea.classList.add("tw-hidden");
    outputTextarea.classList.add("tw-hidden");

    const root = el("div", { id: ROOT_ID });
    
    // Settings state
    let systemPrompt = "You are a helpful assistant.";
    let developerPrompt = "";
    let selectedModel = "gpt-5-2";
    let showSettings = false;
    
    // Valid models list - define this BEFORE loading from localStorage
    const models = [
      { value: "gpt-5-2", label: "GPT-5-2" },
      { value: "gpt-5-2-thinking", label: "GPT-5-2 Thinking" },
      { value: "gpt-5-mini-thinking", label: "GPT-5 Thinking Mini (Alpha Model idek)" },
    ];
    const validModelValues = models.map(m => m.value);
    
    // Try to load saved settings
    try {
      const savedModel = localStorage.getItem('chatgpt-translator-model');
      const savedPrompt = localStorage.getItem('chatgpt-translator-prompt');
      const savedDevPrompt = localStorage.getItem('chatgpt-translator-dev-prompt');
      
      // Only use saved model if it's in the valid models list
      if (savedModel && validModelValues.includes(savedModel)) {
        selectedModel = savedModel;
      } else if (savedModel) {
        // Clear invalid saved model
        localStorage.removeItem('chatgpt-translator-model');
        console.log('[ChatGPT Translator] Cleared invalid saved model:', savedModel);
      }
      
      if (savedPrompt) systemPrompt = savedPrompt;
      if (savedDevPrompt) developerPrompt = savedDevPrompt;
    } catch (e) {
      console.log('[ChatGPT Translator] Could not load saved settings');
    }
    
    // Update model and prompts in page context after a short delay to ensure injector is loaded
    setTimeout(() => {
      updateModel(selectedModel);
      updateSystemPrompt(systemPrompt);
      updateDeveloperPrompt(developerPrompt);
    }, 500);

    const chat = el("div", { class: "tw-chat" });

    // Message bubbles state
    let currentBotBubble = null;
    let lastSeenOutput = "";

    function addUserBubble(text) {
      const row = el("div", { class: "tw-row tw-user" });
      const bubble = el("div", { class: "tw-bubble", text });
      row.appendChild(bubble);
      chat.appendChild(row);
      scrollToBottom();
      return bubble;
    }

    // Simple markdown renderer for code blocks
    function renderMarkdown(text) {
      // Escape HTML first
      let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      
      // Code blocks with language (```python ... ```)
      html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang || 'plaintext';
        return `<pre class="tw-code-block" data-lang="${language}"><code>${code.trim()}</code></pre>`;
      });
      
      // Inline code (`code`)
      html = html.replace(/`([^`]+)`/g, '<code class="tw-inline-code">$1</code>');
      
      // Bold (**text**)
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      
      // Italic (*text*)
      html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      
      // Line breaks
      html = html.replace(/\n/g, '<br>');
      
      return html;
    }
    
    function addBotBubble(text) {
      const row = el("div", { class: "tw-row tw-bot" });
      const bubble = el("div", { class: "tw-bubble" });
      bubble.innerHTML = renderMarkdown(text);
      
      const container = el("div", { class: "tw-bot-container" });
      container.appendChild(bubble);
      
      row.appendChild(container);
      chat.appendChild(row);
      scrollToBottom();

      return bubble;
    }

    function scrollToBottom() {
      setTimeout(() => {
        chat.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    }

    // Monitor output textarea for changes
    function syncOutput() {
      if (!currentBotBubble) return;
      const val = outputTextarea.value || "";
      if (val !== lastSeenOutput) {
        lastSeenOutput = val;
        currentBotBubble.innerHTML = renderMarkdown(val || "Thinking...");
        scrollToBottom();
      }
    }

    const syncInterval = setInterval(syncOutput, 100);
    window.addEventListener("beforeunload", () => clearInterval(syncInterval), { once: true });

    outputTextarea.addEventListener("input", syncOutput);
    outputTextarea.addEventListener("change", syncOutput);

    // Header with settings button
    const header = el("div", { class: "tw-header" });
    
    const headerLeft = el("div", { class: "tw-header-left" });
    const title = el("div", { class: "tw-header-title", text: "FreeGPT lol" });
    const modelBadge = el("div", { class: "tw-model-badge" });
    
    function updateModelBadge() {
      modelBadge.textContent = selectedModel;
    }
    updateModelBadge();
    
    headerLeft.appendChild(title);
    headerLeft.appendChild(modelBadge);
    
    const settingsBtn = el("button", { class: "tw-settings-btn", type: "button", title: "Settings" });
    settingsBtn.appendChild(svgIcon("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"));
    
    header.appendChild(headerLeft);
    header.appendChild(settingsBtn);

    // Settings Panel
    const settingsPanel = el("div", { class: "tw-settings-panel" });
    
    const settingsContent = el("div", { class: "tw-settings-content" });
    
    const settingsHeader = el("div", { class: "tw-settings-header" });
    const settingsTitle = el("h3", { class: "tw-settings-title", text: "Settings" });
    const closeBtn = el("button", { class: "tw-close-btn", type: "button", title: "Close" });
    closeBtn.appendChild(svgIcon("M18 6 6 18M6 6l12 12"));
    settingsHeader.appendChild(settingsTitle);
    settingsHeader.appendChild(closeBtn);
    
    // Model Selection
    const modelGroup = el("div", { class: "tw-setting-group" });
    const modelLabel = el("label", { class: "tw-setting-label", text: "Model" });
    const modelSelect = el("select", { class: "tw-setting-select" });
    
    models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.value;
      opt.textContent = m.label;
      if (m.value === selectedModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });
    
    modelSelect.addEventListener("change", () => {
      selectedModel = modelSelect.value;
      updateModelBadge();
      
      // Update model in page context
      updateModel(selectedModel);
      
      // Show confirmation toast
      showToast(`Model changed to ${selectedModel}`);
      
      // Save to localStorage for persistence
      try {
        localStorage.setItem('chatgpt-translator-model', selectedModel);
      } catch (e) {}
    });
    
    modelGroup.appendChild(modelLabel);
    modelGroup.appendChild(modelSelect);
    
    // System Prompt
    const promptGroup = el("div", { class: "tw-setting-group" });
    const promptLabel = el("label", { class: "tw-setting-label", text: "System Prompt" });
    const promptTextarea = el("textarea", { class: "tw-setting-textarea" });
    promptTextarea.value = systemPrompt;
    promptTextarea.rows = 4;
    promptTextarea.placeholder = "Enter system prompt...";
    
    promptTextarea.addEventListener("input", () => {
      systemPrompt = promptTextarea.value;
    });
    
    promptTextarea.addEventListener("blur", () => {
      showToast('System prompt updated');
      updateSystemPrompt(systemPrompt);
      
      try {
        localStorage.setItem('chatgpt-translator-prompt', systemPrompt);
      } catch (e) {}
    });
    
    const promptHint = el("div", { class: "tw-setting-hint", text: "The system message that sets the AI's behavior" });
    
    promptGroup.appendChild(promptLabel);
    promptGroup.appendChild(promptTextarea);
    promptGroup.appendChild(promptHint);
    
    // Developer Prompt
    const devPromptGroup = el("div", { class: "tw-setting-group" });
    const devPromptLabel = el("label", { class: "tw-setting-label", text: "Developer Prompt" });
    const devPromptTextarea = el("textarea", { class: "tw-setting-textarea" });
    devPromptTextarea.value = developerPrompt;
    devPromptTextarea.rows = 4;
    devPromptTextarea.placeholder = "Enter developer prompt (optional)...";
    
    devPromptTextarea.addEventListener("input", () => {
      developerPrompt = devPromptTextarea.value;
    });
    
    devPromptTextarea.addEventListener("blur", () => {
      showToast('Developer prompt updated');
      updateDeveloperPrompt(developerPrompt);
      
      try {
        localStorage.setItem('chatgpt-translator-dev-prompt', developerPrompt);
      } catch (e) {}
    });
    
    const devPromptHint = el("div", { class: "tw-setting-hint", text: "Additional instructions for the AI (added after user message)" });
    
    devPromptGroup.appendChild(devPromptLabel);
    devPromptGroup.appendChild(devPromptTextarea);
    devPromptGroup.appendChild(devPromptHint);
    
    settingsContent.appendChild(settingsHeader);
    settingsContent.appendChild(modelGroup);
    settingsContent.appendChild(promptGroup);
    settingsContent.appendChild(devPromptGroup);
    
    settingsPanel.appendChild(settingsContent);
    
    // Toggle settings
    function toggleSettings() {
      showSettings = !showSettings;
      if (showSettings) {
        settingsPanel.classList.add("tw-show");
        settingsBtn.classList.add("tw-active");
      } else {
        settingsPanel.classList.remove("tw-show");
        settingsBtn.classList.remove("tw-active");
      }
    }
    
    settingsBtn.addEventListener("click", toggleSettings);
    closeBtn.addEventListener("click", toggleSettings);
    
    settingsPanel.addEventListener("click", (e) => {
      if (e.target === settingsPanel) toggleSettings();
    });

    // Input composer
    const composerWrap = el("div", { class: "tw-composerWrap" });
    const composer = el("div", { class: "tw-composer" });

    const inputBox = el("textarea", { class: "tw-input" });
    inputBox.placeholder = "Message ChatGPT";
    inputBox.rows = 1;

    inputBox.addEventListener("input", () => {
      inputBox.style.height = "auto";
      inputBox.style.height = Math.min(inputBox.scrollHeight, 200) + "px";
    });

    const sendBtn = el("button", { class: "tw-send", type: "button", title: "Send message" });
    const sendIconWrapper = el("span", { class: "tw-send-icon" });
    sendIconWrapper.appendChild(svgIcon("M2 21l21-9L2 3v7l15 2-15 2z"));
    sendBtn.appendChild(sendIconWrapper);

    function sendMessage(text, isRegenerate = false) {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (!isRegenerate) {
        addUserBubble(trimmed);
      }

      currentBotBubble = addBotBubble("Thinking...");
      lastSeenOutput = "";

      setNativeValue(inputTextarea, trimmed);
      inputTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      inputTextarea.dispatchEvent(new Event("change", { bubbles: true }));

      if (!isRegenerate) {
        inputBox.value = "";
        inputBox.style.height = "auto";
      }
      
      inputBox.focus();

      setTimeout(syncOutput, 100);
      setTimeout(syncOutput, 300);
      setTimeout(syncOutput, 600);
    }

    sendBtn.addEventListener("click", () => sendMessage(inputBox.value));

    inputBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(inputBox.value);
      }
    });

    composer.appendChild(inputBox);
    composer.appendChild(sendBtn);
    composerWrap.appendChild(composer);

    const disclaimer = el("div", {
      class: "tw-disclaimer",
      text: "ChatGPT can make mistakes. Check important info."
    });

    root.appendChild(header);
    root.appendChild(settingsPanel);
    root.appendChild(chat);
    root.appendChild(composerWrap);
    root.appendChild(disclaimer);

    setTimeout(() => inputBox.focus(), 100);

    return root;
  }

  function applyUI() {
    const translatorRoot = findTranslatorRoot();
    if (!translatorRoot) return;

    const textareas = $all("textarea", translatorRoot);
    const inputTextarea = textareas.find(t => !t.hasAttribute("readonly"));
    const outputTextarea = textareas.find(t => t.hasAttribute("readonly"));

    if (!inputTextarea || !outputTextarea) return;

    translatorRoot.setAttribute(DONE_ATTR, "1");

    const existingRoot = $(`#${ROOT_ID}`, translatorRoot);
    if (existingRoot) existingRoot.remove();

    translatorRoot.appendChild(buildChatUI({ translatorRoot, inputTextarea, outputTextarea }));
  }

  // Initial application
  applyUI();

  // Watch for DOM changes (SPA navigation)
  const observer = new MutationObserver(() => {
    if (!document.getElementById(ROOT_ID)) {
      applyUI();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();