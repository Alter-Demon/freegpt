freegptThis extension injects into the translation page of ChatGPT, replacing it with a fully functional chat UI. You can choose the model, system prompt, and developer prompt in the settings.how it worksThe extension intercepts all /conversation requests at the network level, replacing the model, system prompt, and developer prompt values with your current settings before they reach OpenAI's servers.features
model selection - switch between gpt-5-2, gpt-5-2-thinking, and other models
custom system prompt - define how the AI behaves
custom developer prompt - add additional instructions after user messages
markdown rendering - code blocks, inline code, bold, and italic text render nicely
settings persistence - your preferences are saved in localStorage
installation
clone or download this repo
go to chrome://extensions
enable "Developer mode"
click "Load unpacked"
select the extension folder
usage
go to chatgpt.com/g/g-translate (or any translate page)
the custom UI will replace the translator interface
click the settings icon to change model and prompts
start chatting
files
manifest.json - extension config
content.js - UI injection and settings management
injector.js - network-level request interception
styles.css - dark theme styling
notethis is heavily vibecoded. im not a frontend dev.
