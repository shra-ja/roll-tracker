document.querySelector('main')!.innerHTML = `
  <header>
    <a class="wordmark" href="#">ROLL TRACKER</a>
    <span class="offline"><span aria-hidden="true">●</span> Offline</span>
  </header>
  <section class="intro" aria-labelledby="title">
    <p class="eyebrow">A little history. All yours.</p>
    <h1 id="title">Your rolls, kept local.</h1>
    <p class="lede">A home for your gacha history, right on your device.</p>
  </section>
  <section class="collection" aria-label="Roll history">
    <div class="toolbar">
      <div>
        <label for="game">Your game</label>
        <select id="game">
          <option value="genshin-impact">Genshin Impact</option>
          <option value="honkai-star-rail">Honkai: Star Rail</option>
        </select>
      </div>
      <span class="collection-label">Your collection starts here</span>
    </div>
    <div class="empty" role="status" aria-live="polite" aria-atomic="true">
      <span class="empty-icon" aria-hidden="true">✧</span>
      <h2></h2>
      <p>File import is coming next.</p>
      <p class="detail">Your history will stay on this device. No account needed.</p>
    </div>
  </section>
  <footer>Made for your collection. No cloud required.</footer>
`;

const game = document.querySelector<HTMLSelectElement>('#game')!;
const heading = document.querySelector('h2')!;

function updateGame() {
  heading.textContent = `No ${game.selectedOptions[0].textContent} rolls yet`;
}

game.addEventListener('change', updateGame);
updateGame();
