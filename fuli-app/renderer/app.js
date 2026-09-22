const promptInput = document.getElementById('promptInput');
const submitBtn = document.getElementById('submitBtn');
const cancelBtn = document.getElementById('cancelBtn');
const closeBtn = document.getElementById('closeBtn');
const micBtn = document.getElementById('micBtn');
const actionCard = document.getElementById('actionCard');
const statusText = document.getElementById('statusText');
const summaryText = document.getElementById('summaryText');
const statusSpinner = document.getElementById('statusSpinner');
const stepsList = document.getElementById('stepsList');

let isRunning = false;
let currentSteps = [];

// Focus input on load
promptInput.focus();

function resetToCleanState() {
  if (!isRunning) {
    promptInput.value = '';
    setExpanded(false);
    statusText.textContent = 'Fuli is ready';
    summaryText.textContent = '';
    stepsList.innerHTML = '';
  }
}

if (window.fuliAPI && window.fuliAPI.onFocusInput) {
  window.fuliAPI.onFocusInput(() => {
    resetToCleanState();
    promptInput.focus();
  });
}

window.addEventListener('focus', () => {
  resetToCleanState();
  promptInput.focus();
});

if (window.fuliAPI && window.fuliAPI.onSetPromptAndRun) {
  window.fuliAPI.onSetPromptAndRun((prompt) => {
    promptInput.value = prompt;
    if (micBtn) micBtn.classList.remove('listening');
    startExecution();
  });
}

if (window.fuliAPI && window.fuliAPI.onSetPromptOnly) {
  window.fuliAPI.onSetPromptOnly((prompt) => {
    promptInput.value = prompt;
    if (micBtn) micBtn.classList.remove('listening');
    promptInput.focus();
  });
}

if (window.fuliAPI && window.fuliAPI.onSetStatus) {
  window.fuliAPI.onSetStatus((status) => {
    statusText.textContent = status;
    setExpanded(true, 130);
  });
}

function setExpanded(expanded, customHeight) {
  if (expanded) {
    actionCard.classList.remove('hidden');
    const targetHeight = customHeight || 360;
    window.fuliAPI.resizeWindow(680, targetHeight);
  } else {
    actionCard.classList.add('hidden');
    window.fuliAPI.resizeWindow(680, 76);
  }
}

function renderSteps(steps) {
  currentSteps = steps;
  stepsList.innerHTML = '';

  steps.forEach((step) => {
    const el = document.createElement('div');
    el.className = 'step-item';
    el.id = `step-${step.id}`;

    const icon = document.createElement('span');
    icon.className = 'step-icon';
    icon.textContent = '○';

    const text = document.createElement('span');
    text.className = 'step-text';
    text.textContent = step.description;

    const badge = document.createElement('span');
    badge.className = 'step-badge';
    badge.textContent = step.action.replace('browser_', '').replace('system_', '');

    el.appendChild(icon);
    el.appendChild(text);
    el.appendChild(badge);
    stepsList.appendChild(el);
  });

  // Calculate dynamic height based on steps
  const cardHeight = Math.min(140 + steps.length * 48, 420);
  setExpanded(true, cardHeight);
}

function updateStepStatus(stepId, state) {
  const el = document.getElementById(`step-${stepId}`);
  if (!el) return;

  const icon = el.querySelector('.step-icon');

  if (state === 'active') {
    el.className = 'step-item active';
    if (icon) icon.textContent = '▶';
  } else if (state === 'completed') {
    el.className = 'step-item completed';
    if (icon) icon.textContent = '✓';
  }
}

function startExecution() {
  const prompt = promptInput.value.trim();
  if (!prompt || isRunning) return;

  isRunning = true;
  submitBtn.classList.add('hidden');
  cancelBtn.classList.remove('hidden');
  promptInput.disabled = true;

  statusText.textContent = 'Fuli is planning your actions...';
  summaryText.textContent = '';
  statusSpinner.classList.remove('hidden');
  stepsList.innerHTML = '';
  setExpanded(true, 150);

  window.fuliAPI.submitPrompt(prompt);
}

function stopExecution() {
  window.fuliAPI.cancelTask();
  statusText.textContent = 'Task stopped.';
  statusSpinner.classList.add('hidden');
  resetUIState();
}

function resetUIState() {
  isRunning = false;
  submitBtn.classList.remove('hidden');
  cancelBtn.classList.add('hidden');
  promptInput.disabled = false;
  if (micBtn) micBtn.classList.remove('listening');
  promptInput.focus();
}

// Event Listeners
submitBtn.addEventListener('click', startExecution);
cancelBtn.addEventListener('click', stopExecution);
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    resetToCleanState();
    window.fuliAPI.closeApp();
  });
}
if (micBtn) {
  micBtn.addEventListener('click', () => {
    micBtn.classList.toggle('listening');
    if (micBtn.classList.contains('listening')) {
      statusText.textContent = "🎙️ Listening... Speak your command to Fuli";
      setExpanded(true, 130);
      if (window.fuliAPI && window.fuliAPI.triggerMicListen) {
        window.fuliAPI.triggerMicListen();
      }
    } else {
      setExpanded(false);
    }
  });
}

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    startExecution();
  } else if (e.key === 'Escape') {
    if (isRunning) {
      stopExecution();
    } else {
      resetToCleanState();
      window.fuliAPI.hideWindow();
    }
  }
});

// IPC Progress Stream from Electron Main Process
window.fuliAPI.onProgress((data) => {
  if (data.type === 'status') {
    statusText.textContent = data.message;
  } else if (data.type === 'plan_ready') {
    statusText.textContent = 'Executing actions on screen...';
    summaryText.textContent = data.summary;
    renderSteps(data.steps);
  } else if (data.type === 'step_start') {
    updateStepStatus(data.stepId, 'active');
  } else if (data.type === 'step_done') {
    updateStepStatus(data.stepId, 'completed');
  } else if (data.type === 'cancelled') {
    statusText.textContent = data.message;
    statusSpinner.classList.add('hidden');
    resetUIState();
  }
});

window.fuliAPI.onComplete((result) => {
  statusSpinner.classList.add('hidden');
  statusText.textContent = '✓ Actions completed successfully!';
  statusText.style.color = '#4ade80';
  resetUIState();

  // Reset color after 4 seconds
  setTimeout(() => {
    statusText.style.color = '';
  }, 4000);
});

window.fuliAPI.onError((err) => {
  statusSpinner.classList.add('hidden');
  statusText.textContent = `Error: ${err.message}`;
  statusText.style.color = '#ef4444';
  resetUIState();

  setTimeout(() => {
    statusText.style.color = '';
  }, 5000);
});
