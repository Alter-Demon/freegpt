// This script runs in the MAIN world (page context) and intercepts fetch requests
(function() {
  if (window.__CHATGPT_TRANSLATOR_INTERCEPTED__) return;
  window.__CHATGPT_TRANSLATOR_INTERCEPTED__ = true;
  window.__CHATGPT_TRANSLATOR_MODEL__ = "gpt-5-2";
  window.__CHATGPT_TRANSLATOR_SYSTEM_PROMPT__ = "You are a helpful assistant.";
  window.__CHATGPT_TRANSLATOR_DEVELOPER_PROMPT__ = "";
  
  // Helper function to check if URL matches /conversation endpoint
  function isConversationUrl(url) {
    if (!url) return false;
    const urlString = url.toString();
    return urlString.includes('/conversation');
  }
  
  // Function to modify the request body
  function modifyRequestBody(bodyData) {
    const currentModel = window.__CHATGPT_TRANSLATOR_MODEL__;
    const systemPrompt = window.__CHATGPT_TRANSLATOR_SYSTEM_PROMPT__;
    const developerPrompt = window.__CHATGPT_TRANSLATOR_DEVELOPER_PROMPT__;
    
    // Modify the model
    if (bodyData.model !== undefined) {
      bodyData.model = currentModel;
    }
    
    // Modify messages array if it exists
    if (bodyData.messages && Array.isArray(bodyData.messages)) {
      bodyData.messages = bodyData.messages.map(msg => {
        // Modify system message
        if (msg.author && msg.author.role === 'system') {
          return {
            ...msg,
            content: {
              ...msg.content,
              parts: [systemPrompt]
            }
          };
        }
        
        // Modify developer message
        if (msg.author && msg.author.role === 'developer') {
          return {
            ...msg,
            content: {
              ...msg.content,
              parts: [developerPrompt]
            }
          };
        }
        
        return msg;
      });
      
      // If there's no developer message but we have a developer prompt, add one
      if (developerPrompt) {
        const hasDeveloperMsg = bodyData.messages.some(msg => msg.author && msg.author.role === 'developer');
        if (!hasDeveloperMsg) {
          bodyData.messages.push({
            id: crypto.randomUUID(),
            author: { role: 'developer' },
            content: {
              content_type: 'text',
              parts: [developerPrompt]
            }
          });
        }
      }
      
      // If there's no system message but we have a system prompt, add one at the beginning
      if (systemPrompt) {
        const hasSystemMsg = bodyData.messages.some(msg => msg.author && msg.author.role === 'system');
        if (!hasSystemMsg) {
          bodyData.messages.unshift({
            id: crypto.randomUUID(),
            author: { role: 'system' },
            content: {
              content_type: 'text',
              parts: [systemPrompt]
            }
          });
        }
      }
    }
    
    return bodyData;
  }
  
  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    let [url, options] = args;
    
    // Check if this is a conversation request based on URL
    if (isConversationUrl(url) && options && options.body && typeof options.body === 'string') {
      try {
        let bodyData = JSON.parse(options.body);
        bodyData = modifyRequestBody(bodyData);
        
        // Create new options with modified body
        options = { ...options, body: JSON.stringify(bodyData) };
      } catch (e) {
        console.log('Could not parse body:', e.message);
      }
    }
    
    return originalFetch.apply(this, [url, options]);
  };
  
  // Intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(...args) {
    this._url = args[1];
    return originalXHROpen.apply(this, args);
  };
  
  XMLHttpRequest.prototype.send = function(body) {
    // Check if this is a conversation request based on URL
    if (isConversationUrl(this._url) && body && typeof body === 'string') {
      try {
        let bodyData = JSON.parse(body);
     
        // Modify the request body
        bodyData = modifyRequestBody(bodyData);
        
        body = JSON.stringify(bodyData);
      } catch (e) {
        console.log('Could not parse XHR body:', e.message);
      }
    }
    
    return originalXHRSend.call(this, body);
  };
  
  // Listen for model updates from content script
  window.addEventListener('chatgpt-translator-update-model', function(e) {
    if (e.detail && e.detail.model) {
      window.__CHATGPT_TRANSLATOR_MODEL__ = e.detail.model;
      console.log('Model updated to:', e.detail.model);
    }
  });
  
  // Listen for system prompt updates from content script
  window.addEventListener('chatgpt-translator-update-system-prompt', function(e) {
    if (e.detail && e.detail.prompt !== undefined) {
      window.__CHATGPT_TRANSLATOR_SYSTEM_PROMPT__ = e.detail.prompt;
      console.log('System prompt updated to:', e.detail.prompt);
    }
  });
  
  // Listen for developer prompt updates from content script
  window.addEventListener('chatgpt-translator-update-developer-prompt', function(e) {
    if (e.detail && e.detail.prompt !== undefined) {
      window.__CHATGPT_TRANSLATOR_DEVELOPER_PROMPT__ = e.detail.prompt;
      console.log('Developer prompt updated to:', e.detail.prompt);
    }
  });
  
  console.log('Request interception enabled');
})();