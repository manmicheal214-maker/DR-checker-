(() => {
  const host = document.getElementById("site-footer");
  if (!host) return;

  host.innerHTML = `
    <footer class="site-footer">
      <p>Domain Rating data provided through Ahrefs API.</p>
      <nav aria-label="Site footer">
        <a href="/about.html">About</a><span aria-hidden="true">|</span>
        <a href="/how-it-works.html">How It Works</a><span aria-hidden="true">|</span>
        <a href="/privacy.html">Privacy</a><span aria-hidden="true">|</span>
        <a href="/terms.html">Terms</a><span aria-hidden="true">|</span>
        <a href="/contact.html">Contact</a>
      </nav>
    </footer>
  `;
})();
