  const PIN_CODE = '5512';
  const pinSessionKey = 'vishesh-jewellers-pin-unlocked';
  const showPinLock = () => {
    if (sessionStorage.getItem(pinSessionKey) === 'true') return;
    const lock = document.createElement('section');
    lock.className = 'pin-lock';
    lock.innerHTML = '<div class="pin-lock-card"><img class="pin-lock-logo" src="/assets/vishesh-jewellers-logo.png" alt="Vishesh Jewellers"><div class="eyebrow">Private workspace</div><h1>Welcome back</h1><p>Enter your 4-digit PIN to open Vishesh Jewellers.</p><form class="pin-lock-form" id="pinLockForm"><input class="pin-lock-input" id="pinLockInput" type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]*" maxlength="4" aria-label="Four digit PIN" autofocus><div class="pin-lock-error" id="pinLockError" role="alert"></div><button class="btn btn-gold" type="submit">Unlock App</button></form></div>';
    document.body.classList.add('pin-locked');
    document.body.appendChild(lock);
    const input = document.getElementById('pinLockInput');
    requestAnimationFrame(() => input.focus());
    document.getElementById('pinLockForm').addEventListener('submit', event => {
      event.preventDefault();
      if (!input.value.trim()) {
        document.getElementById('pinLockError').textContent = 'PIN is required.';
        input.focus();
        return;
      }
      if (input.value === PIN_CODE) {
        sessionStorage.setItem(pinSessionKey, 'true');
        document.body.classList.remove('pin-locked');
        lock.remove();
        return;
      }
      document.getElementById('pinLockError').textContent = 'Incorrect PIN. Please try again.';
      input.value = '';
      input.focus();
    });
  };
  showPinLock();
  window.orderMode = false;
