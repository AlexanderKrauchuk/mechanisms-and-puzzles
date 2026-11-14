/**
 * Ограничитель частоты запросов: не больше limit запросов за windowMs на один ключ.
 * Защищает мастера от потока ходов (случайного или намеренного): каждый ход пишет во flags.
 * Время подставляется снаружи, чтобы тесты не ждали.
 */
export class RateLimiter {
  #hits = new Map();

  constructor({ limit = 30, windowMs = 5000, now = () => Date.now() } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** true, если запрос разрешён (и он засчитан), false, если лимит исчерпан. */
  allow(key) {
    const t = this.now();
    const recent = (this.#hits.get(key) ?? []).filter((time) => t - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.#hits.set(key, recent);
    return true;
  }

  reset() {
    this.#hits.clear();
  }
}
