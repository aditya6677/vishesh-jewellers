  const safe = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const invoiceNumberInput = document.getElementById('inv-no');
  invoiceNumberInput.disabled = true;
  invoiceNumberInput.title = 'Invoice number is assigned automatically';
  const useLogo = (selector, className) => {
    const placeholder = document.querySelector(selector);
    if (!placeholder) return;
    const logo = document.createElement('img');
    logo.src = '/assets/vishesh-jewellers-logo.png';
    logo.alt = 'Vishesh Jewellers';
    logo.className = className;
    placeholder.replaceWith(logo);
  };
  useLogo('.brand > svg', 'brand-logo');
  useLogo('.paper-brand > svg', 'invoice-logo');
  document.querySelectorAll('.brand-text p, .paper-brand p').forEach(tagline => {
    tagline.textContent = 'Beginning... of Special Relationship...';
  });
  const appFooter = document.createElement('footer');
  appFooter.className = 'app-footer';
  appFooter.innerHTML = '<span>© ' + new Date().getFullYear() + ' <strong>Vishesh Jewellers</strong></span><span class="footer-separator">•</span><span>Invoice &amp; Inventory Management</span><span class="footer-separator">•</span><span>Records saved locally</span>';
  document.body.appendChild(appFooter);
