(function () {
  const placeholder = document.getElementById("site-footer");
  if (!placeholder) return;

  placeholder.innerHTML = `
    <footer class="site-footer">
      <p>Domain Rating data provided through Ahrefs API.</p>
      <nav aria-label="Site links">
        <a href="/about.html">About</a>
        <a href="/how-it-works.html">How It Works</a>
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
        <a href="/contact.html">Contact</a>
      </nav>
    </footer>
  `;
}());
